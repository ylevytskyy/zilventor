# Drawing OPFS autosave + reload-recovery — design

**Date:** 2026-05-26
**Status:** Approved (brainstorming) → writing-plans
**Feature:** A drawing's edits persist continuously to OPFS, and on page reload the last-open drawing reappears in the viewport with its projection source re-warmed (staleness/Regenerate work). Scoped to drawings.

## Goal

Today (verified): **no document type auto-restores on reload** — the app boots to an empty viewport (no last-open pointer, no boot rehydration; only a `showEdgeBands` UI pref in localStorage). Open/Save are **disk-only** (`showOpenFilePicker`/`showSaveFilePicker`); the one OPFS browser (`loadAssemblyTiles`) lists only `.zipt`/`.ziasm` for component insertion. Drawings autosave **once at creation** (`saveDrawingToOpfs` → `drawings/${id}.zidw`); subsequent edits are NOT autosaved (App.tsx ~3470 early-returns for `doc.kind === 'drawing'`), and even the initial file has no reopen path.

This feature closes that gap for drawings: continuous autosave of drawing edits + boot auto-restore of the last-open drawing.

**Decided in brainstorming (recommendation accepted):** Autosave drawing edits to OPFS **AND** persist a last-open pointer so the drawing reopens into the viewport on reload. Parts/assemblies session-restore is explicitly deferred (a part/assembly being active clears the pointer → reload boots empty, unchanged behavior).

## Verified existing pieces (reuse, do not rebuild)

- Autosave debounce effect: `packages/app/src/App.tsx` ~3439–3528 — watches `activeDocument`, 500ms `setTimeout` debounce; part → `kernel.saveToBytes` → `opfs.write('${name}.zipt')`; assembly → `packAssembly` → `opfs.write('${name}.ziasm')`; **drawing → early-return (the gap, ~3470)**.
- `packDrawing(doc)`/`unpackDrawing(bytes)`: `packages/app/src/storage/DrawingPacker.ts` — async; tar.gz envelope with `manifest.json` only (no kernel geometry — drawings store projected Edge2D). Uses the synchronous `writeTarGz` (per [[project_drawing_file_reopen_feature]]), so main-thread packing is safe.
- `saveDrawingToOpfs`: `packages/app/src/storage/saveDrawingToOpfs.ts` — writes `drawings/${id}.zidw` (id-based path) at creation.
- `activateDrawingDocument(doc, {kernel, opfs})`: `packages/app/src/drawing/activateDrawingDocument.ts` — re-loads the part/assembly source into the kernel and recomputes the composite fingerprint; on missing source → nulls slots + setStatus (graceful). This is what makes a restored drawing Regenerate-able.
- OPFS API: `packages/kernel/src/storage/Opfs.ts` — `write/read/exists/delete/listAll`.
- `ActiveDocument` discriminated union (`useAppStore.ts` ~24): `{kind:'part'|'assembly'|'drawing', document}`.

## Architecture — three small bounded units + one chokepoint

### 1. Autosave wiring (App.tsx debounce effect)
Replace the drawing early-return (~3470) with:
```ts
const bytes = await packDrawing(doc.document);
await opfs.write(`drawings/${doc.document.id}.zidw`, bytes);
```
Reuses the existing `activeDocument` watch + 500ms debounce verbatim. Id-based path (rename-safe; matches `saveDrawingToOpfs`).

### 2. Last-open pointer — `packages/app/src/storage/lastOpenDocument.ts` (pure localStorage module)
- `setLastOpenDrawing(opfsPath: string): void`
- `getLastOpenDrawing(): { kind: 'drawing'; opfsPath: string } | null`
- `clearLastOpen(): void`

Stored as JSON under a single key (e.g. `zilventor:lastOpenDocument`). Guarded with `typeof localStorage !== 'undefined'` (matches the existing `showEdgeBands` pattern; the Node-25 test shim covers tests).

### 3. Boot restore — `packages/app/src/drawing/restoreLastOpenDrawing.ts` + an App.tsx startup effect
`restoreLastOpenDrawing({ kernel, opfs }): Promise<boolean>`:
1. `getLastOpenDrawing()`; if null → return false.
2. If `!(await opfs.exists(opfsPath))` → `clearLastOpen()`, return false.
3. `bytes = await opfs.read(opfsPath)`; `doc = await unpackDrawing(bytes)`; `await activateDrawingDocument(doc, { kernel, opfs })`; return true.
4. On any throw (corrupt) → `clearLastOpen()`, return false (no crash).

App.tsx startup effect: runs **once** after kernel+opfs are ready, guarded so it only fires on cold boot (no active document yet) — never clobbers an in-progress new doc.

### Chokepoint for set/clear (in the autosave effect, after a successful write)
- `doc.kind === 'drawing'` → `setLastOpenDrawing('drawings/${id}.zidw')`
- `doc.kind === 'part' | 'assembly'` → `clearLastOpen()`

Single place keeps pointer consistent: a drawing stays pointed-to; switching to a part/assembly clears it (reload → empty, unchanged).

## Data flow

Edit drawing → store update → debounce (500ms) → `packDrawing` → `opfs.write(drawings/${id}.zidw)` + `setLastOpenDrawing`. Reload → boot effect → `restoreLastOpenDrawing` → pointer → `unpackDrawing` → `activateDrawingDocument` → drawing back in viewport, source re-warmed, views stale if the source changed → Regenerate available.

## Error handling
- Pointer present but OPFS file missing → clear pointer, boot empty (no crash).
- `unpackDrawing` throws (corrupt bytes) → clear pointer, boot empty.
- Source part/assembly missing on restore → `activateDrawingDocument` already nulls slots + setStatus (drawing opens, Regenerate disabled). No new handling.
- Rapid edits → existing debounce coalesces. Main-thread pack is safe (sync `writeTarGz`).

## Testing

**TDD slices (red→green):**
1. `lastOpenDocument.ts` set/get/clear round-trip + null when unset + localStorage-absent guard.
2. Autosave drawing branch writes packed bytes to `drawings/${id}.zidw` on activeDocument change (mock opfs.write; assert path + that packDrawing output was written).
3. Pointer set for drawing autosave; cleared for part + assembly autosave.
4. `restoreLastOpenDrawing`: pointer→exists→unpack→activate (assert activateDrawingDocument called with the doc); missing file → clears pointer, returns false, no activate; corrupt bytes → clears pointer, returns false, no throw.

**e2e T-6-20** (real browser, `tests/e2e/drawing/`): create a drawing → add a base view (autosave fires) → `page.reload()` → assert the drawing + its view reappear in the viewport. Drives the REAL packDrawing → OPFS write → boot-restore → unpackDrawing → activateDrawingDocument path (no stand-ins — per the file-reopen lesson). Verify the restored view is present (e.g. `[data-view-id]` / visibleEdges > 0).

## Out of scope (v1)
- Parts/assemblies session restore (deferred — the pointer is drawing-only; non-drawing active clears it).
- Restoring multiple open documents / tabs.
- An OPFS drawing browser UI (Open stays disk-only; restore is automatic).

## Open items for the plan's verifier / implementer to confirm against real code
1. Exact line of the drawing early-return in the autosave effect and how `opfs`/`doc` are in scope there.
2. The startup-effect guard condition that means "cold boot, nothing open yet" (which store field to check) so restore never clobbers a user action.
3. Whether `activateDrawingDocument` sets `activeDocument`/`activeDrawing` such that the restored drawing renders without extra wiring.
4. localStorage key name + that the Node-25 test shim (`packages/app/src/test-setup.ts`) makes the pointer module testable.
