# Drawing file-reopen + source-load on activation — Design

**Date:** 2026-05-26
**Status:** Approved (design); pending implementation plan
**Base:** HEAD `06d7805` (master) — built on the just-shipped drawing view-projection pipeline (`2c70aa8`)
**Manifest:** v19 — **no bump** (reads existing v19 files; no serialized shape change)

## Problem

The drawing view-projection pipeline (shipped `2c70aa8`) wired live projection,
Regenerate, and activation-time staleness — but left one documented limitation:
**you cannot reopen a saved `.zidw` drawing.** `FileTab.handleOpen`'s drawing
branch is a no-op TODO:

```ts
// packages/app/src/shell/tabs/FileTab.tsx ~94-96
if (kind === 'drawing') {
  // TODO Sub-project 6: implement drawing open
  return;
}
```

Because of this, staleness never fires in the real workflow: the stale marker
only appears for edits made via a fresh `CreateDrawingCommand` within the same
session. The intended loop — **edit a part → reopen its drawing → views flag
stale → Regenerate re-projects** — is broken at the "reopen" step.

## Goal

Implement `.zidw` reopen so that opening a saved drawing:

1. Deserializes the `.zidw` tar.gz envelope → `DrawingDocument`.
2. Activates it (`setActiveDocument`).
3. Re-loads the source part bytes from OPFS → recomputes
   `activeDrawingSourceFingerprint` (djb2 of bytes) and sets
   `activeDrawingSourcePartId` to the freshly-loaded kernel id.
4. The **existing** `DrawingCanvas` `useEffect` runs `computeStaleViewIds` and
   flags any view whose stored `inputFingerprint` ≠ the current fingerprint →
   stale marker → Regenerate re-projects.

This is mostly **wiring an existing pipeline into a new entry point.**
`loadDrawingSource`, the store slots, `computeStaleViewIds`, and
`RegenerateViewCommand` already work. The `.zidw` already stores
`source.partPath` + `source.sourceKind`, so reopen knows which part to reload —
no re-binding needed in the happy path.

## Confirmed product decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Reopen UI | **Unified Open picker** — add `.zidw` to the existing kind-discriminating `handleOpen`; no separate recents list. |
| 2 | Load trigger | **On reopen only** — opening *is* activation (single-active-document model). No per-activation re-read. |
| 3 | Missing/unloadable source part | **Open anyway, disable Regenerate** — saved projection still renders; source slots stay null; non-blocking notice. |
| 4 | Assembly-sourced `.zidw` | **Open, skip source-load** — Regenerate unavailable; assembly projection remains a separate deferred follow-up (currently throws `PART_NOT_IN_STORE`). |

## Architecture — new/changed units

### 1. `packDrawing(doc) → Uint8Array` / `unpackDrawing(bytes) → DrawingDocument`
- **Where:** the drawing serialization module (currently `packages/app/src/storage/saveDrawingToOpfs.ts` builds the tar.gz inline).
- **What:** extract the inline tar.gz build into a pure `packDrawing(doc)`, then
  `saveDrawingToOpfs` writes `packDrawing(doc)` to OPFS. Add the symmetric
  `unpackDrawing(bytes)`: parse tar.gz → read `manifest.json` → validate
  `kind === 'drawing'` and `formatVersion` (reject unknown/future) → return
  `manifest.document` as a `DrawingDocument`.
- **Mirrors:** the existing `packAssembly` / `unpackAssembly` split.
- **Why a unit:** pure, round-trip testable, no store/kernel/OPFS coupling.
- **Plan-time discovery:** confirm whether a `packDrawing` already exists
  separately before extracting.

### 2. `activateDrawingDocument(doc, { kernel, opfs }) → Promise<void>`
- **Where:** the drawing layer (alongside `loadDrawingSource.ts` /
  `CreateDrawingCommand.ts`).
- **What:** the shared open/activate routine. Mirrors `CreateDrawingCommand`
  steps 1–4 minus the create-only `saveDrawingToOpfs`:
  1. `setActiveDocument({ kind: 'drawing', document: doc })`
  2. clear the `loadDrawingSource` module cache (`_clearLoadDrawingSourceCache()`)
     so OPFS is re-read fresh
  3. if `doc.source.sourceKind === 'part'`: `await loadDrawingSource({ partPath:
     doc.source.partPath, kernel, opfs })` → on success
     `setState({ activeDrawingSourcePartId, activeDrawingSourceFingerprint })`
  4. on load failure (`opfs.exists` false / `loadFromBytes` throws) **or**
     `sourceKind === 'assembly'`: set both slots to `null` + surface a
     non-blocking notice. Drawing is already active and renders its saved
     projection; Regenerate is naturally disabled (no source).
- **Why a unit:** isolates the activation contract from the file-picker plumbing;
  unit-testable with mocked kernel/opfs exactly like `CreateDrawingCommand.spec`.
- **Note:** uses `setActiveDocument` (the activation primitive), **not**
  `drawingDocState()` (which is for edit commands). `setActiveDocument` already
  preserves the source slots; this routine sets them explicitly.

### 3. `FileTab.handleOpen` drawing branch
- Replace the `return` with: `const doc = unpackDrawing(bytes); await
  activateDrawingDocument(doc, { kernel, opfs });`
- Add `.zidw` to the `showOpenFilePicker` accept types so the OS dialog lists
  drawing files alongside `.zipt` / `.ziasm`.

## Data flow

```
User → Open → pick cabinet.zidw
  → handleOpen reads bytes → reads manifest → kind === 'drawing'
  → unpackDrawing(bytes) → DrawingDocument
  → activateDrawingDocument(doc):
       setActiveDocument(drawing)
       sourceKind==='part' → loadDrawingSource(partPath)
         → set activeDrawingSourcePartId + activeDrawingSourceFingerprint
       (missing part | assembly) → slots null + notice
  → DrawingCanvas useEffect: computeStaleViewIds(views, fingerprint)
       → stale set → ViewElement shows Regenerate
  → user clicks Regenerate → projectViewFromSource → RegenerateViewCommand
       → fresh projection, stale flag cleared
```

## Error handling

- **Source part missing / kernel load throws** → caught in
  `activateDrawingDocument`; slots null; notice; drawing viewable; Regenerate
  disabled.
- **Assembly-sourced** → skip source-load; slots null; Regenerate unavailable.
- **Malformed / wrong-version `.zidw`** → `unpackDrawing` throws → surfaced the
  same way `handleOpen` already surfaces malformed part/assembly files.

## Testing — TDD slices (red → green per slice)

1. **`pack`/`unpackDrawing` round-trip** (storage unit): `packDrawing(doc)` →
   `unpackDrawing(bytes)` recovers an equal `DrawingDocument`; rejects wrong
   `kind`; rejects unknown `formatVersion`.
2. **`activateDrawingDocument` — happy (part)**: mocked kernel/opfs → asserts
   `setActiveDocument` called with the drawing and slots set to the mock
   `partId` / `sourceFingerprint`.
3. **`activateDrawingDocument` — missing source**: `opfs.exists` false →
   slots null + notice invoked + drawing still activated.
4. **`activateDrawingDocument` — assembly-source**: `sourceKind === 'assembly'`
   → source-load skipped, slots null, drawing still activated.
5. **`handleOpen` drawing branch** (app unit): mocked picker returns drawing
   bytes → `unpackDrawing` + `activateDrawingDocument` invoked; `.zidw` present
   in accept types.
6. **Real-geometry e2e — THE gate** (extends the T-6-17 pattern, CLAUDE.md §6):
   seed a real box part (`buildBox` → `kernel.execute` so its id is in
   `namedShapeCache`) → create a drawing with a base view (real projection) →
   save → edit the part so its OPFS bytes differ (changed param re-saved) →
   reopen the `.zidw` → assert the base view is flagged **stale** → click
   Regenerate → assert the projection changed. Drawing commands are not
   window-exposed → `await import('/src/.../<fn>.ts')` inside `page.evaluate`.
   Add a perf probe only if a new hot path warrants it (reopen is I/O-bound, not
   a render hot path — likely none needed).

## Plan-time discovery items

- **Notice mechanism** — discover the existing toast/notification pattern in the
  shell; reuse it. If none exists, a minimal `console.warn` plus the automatic
  disabled-Regenerate state is acceptable (the notice is a nicety, not
  load-bearing).
- **`packDrawing` existence** — confirm before extracting (see unit 1).

## Out of scope (deferred)

- Assembly-sourced drawing projection / Regenerate (separate seed).
- A "Recent Drawings" list UI.
- Re-binding a drawing to a different source part.
- Per-activation source re-read (only on reopen).

## Manifest / migration

No bump. v19 unchanged — reopen reads existing v19 `.zidw` files; nothing in the
serialized shape changes.
