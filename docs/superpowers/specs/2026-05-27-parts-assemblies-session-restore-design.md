# Parts/assemblies session-restore — design spec

**Date:** 2026-05-27
**Status:** Approved (brainstorming) → ready for implementation plan
**Manifest:** unchanged (runtime + localStorage only; no document schema change)

## Problem

Drawings auto-restore on reload (`lastOpenDocument.ts` + `restoreLastOpenDrawing.ts` + the
500 ms autosave debounce in `App.tsx`). Parts and assemblies do not — even though their bytes
**already autosave to OPFS** on the same debounce:

- assembly: `App.tsx:3688` → `opfs.write(\`${doc.document.name}.ziasm\`, archive)` then `clearLastOpen()`.
- part: `App.tsx:3693` → `opfs.write(\`${doc.document.name}.zipt\`, bytes)` then `clearLastOpen()`.

The drawing path instead calls `setLastOpenDrawing(path)` (in `autosaveDrawing.ts`). And
`LastOpenDocument` is hardcoded to `{ kind: 'drawing'; opfsPath: string }`. So part/assembly
restore was intentionally scoped out — but the persisted bytes exist, so generalizing needs only
a kind-aware pointer + a kind-dispatching restore, **no new autosave plumbing**.

## Goal

On reload, restore the **last-open document of any kind** (part, assembly, or drawing), re-warming
the kernel so a restored part/assembly is immediately editable — identical to opening it via
File→Open.

## Decisions (ratified in brainstorming)

- **Single unified pointer** — one localStorage entry; "resume whatever you last had open." Not
  per-kind memory.
- **Eager rehydration** — load the part's geometry into the kernel on boot (matches the existing
  drawing-source warm), not lazy/on-first-interaction.
- **Mirror the existing open-paths** — reuse the exact loader sequence File→Open uses, so restored
  documents behave identically to opened ones (no new/parallel loader).

## Non-goals

- Fixing the **name-based** OPFS autosave paths (`${name}.zipt` / `${name}.ziasm`). Pre-existing;
  two same-named parts share one working copy. Restore-of-last-active still works because the
  pointer holds the last-written path. Out of scope.
- Multi-document / session-tab restore. A single active document is restored, matching today.
- Restoring view state (camera, active ribbon tab, selection). Only the document is restored.
- No document-schema/manifest change.

## Components

### 1. `packages/app/src/storage/lastOpenDocument.ts`

Widen the pointer type and unify the setter:

```ts
export type LastOpenKind = 'drawing' | 'part' | 'assembly';
export type LastOpenDocument = { kind: LastOpenKind; opfsPath: string };

export function setLastOpenDocument(ptr: LastOpenDocument): void; // JSON.stringify → localStorage
export function getLastOpenDocument(): LastOpenDocument | null;    // parse + validate kind
export function clearLastOpen(): void;                             // unchanged
```

- LocalStorage key `'zilventor:lastOpenDocument'` unchanged.
- Keep backward-compat read: an existing stored `{ kind:'drawing', opfsPath }` parses fine.
- Replace `setLastOpenDrawing` callers with `setLastOpenDocument({ kind:'drawing', opfsPath })`
  (one caller: `autosaveDrawing.ts`). `getLastOpenDrawing` → `getLastOpenDocument`.

### 2. Autosave effect — `App.tsx` (~3688, ~3694)

Replace the two `clearLastOpen()` calls (the bytes are already written immediately above):

```ts
// assembly branch, after opfs.write(`${name}.ziasm`, archive):
setLastOpenDocument({ kind: 'assembly', opfsPath: `${doc.document.name}.ziasm` });
// part branch, after opfs.write(`${name}.zipt`, bytes):
setLastOpenDocument({ kind: 'part', opfsPath: `${doc.document.name}.zipt` });
```

The drawing branch (`autosaveDrawing.ts`) already sets the pointer — now via `setLastOpenDocument`.

### 3. `restoreLastOpenDrawing.ts` → `restoreLastOpenDocument.ts`

Generalize to dispatch on `pointer.kind`. Signature stays `({ kernel, opfs }) => Promise<boolean>`.
Common preamble: read pointer; if absent → `false`; if `!opfs.exists(path)` → `clearLastOpen()` +
`false`; else read bytes, then:

- **`'drawing'`:** existing flow — `unpackDrawing(bytes)` → `activateDrawingDocument(doc, {kernel, opfs})`.
- **`'part'`:** `partId = await kernel.loadFromBytes(bytes)` → `await kernel.execute(partId)` (re-runs
  the feature tree) → `part = await kernel.getPart(partId)` → `setActiveDocument({ kind:'part',
  document: part })`. Using `getPart` (the call File→Open uses) makes the active part's `id` equal
  the kernel id → fully editable. On `execute` failure → `clearLastOpen()` + `false`.
- **`'assembly'`:** `doc = await unpackAssembly(bytes)` → `setActiveDocument({ kind:'assembly',
  document: doc })`. Components warm lazily in the 3D viewport exactly as File→Open does (no eager
  component load).
- return `true` on success.

`setActiveDocument` (useAppStore.ts:383) atomically sets `activePart`/`activeAssembly`/`activeDrawing`.

### 4. Boot effect — `App.tsx` (~972)

Call `restoreLastOpenDocument` instead of `restoreLastOpenDrawing`. The existing
`activeDocument === null` guard prevents clobbering a user action that opened a doc first. No other
change to the effect.

## Data flow

```
edit part/assembly/drawing
  → 500ms debounce → autosave writes bytes to OPFS + setLastOpenDocument({kind, opfsPath})
reload
  → kernelReady → boot effect (activeDocument===null) → restoreLastOpenDocument
      → read pointer → read OPFS bytes → kind dispatch → setActiveDocument(...)
```

## Error handling

- No pointer → no-op, boot to empty.
- Pointer path missing in OPFS → `clearLastOpen()`, boot to empty (existing drawing behavior).
- Part `kernel.loadFromBytes`/`execute` throws → catch, `clearLastOpen()`, boot to empty (don't
  wedge the app on a corrupt working copy).
- Assembly `unpackAssembly` throws → catch, `clearLastOpen()`, boot to empty.

## Testing

1. **`lastOpenDocument` round-trip**: `setLastOpenDocument({kind:'part'|'assembly'|'drawing', …})`
   → `getLastOpenDocument()` returns it; malformed/legacy value handled; `clearLastOpen` empties it.
2. **`restoreLastOpenDocument` dispatch** (mock `kernel`/`opfs`):
   - part: pointer `kind:'part'` → calls `loadFromBytes`+`execute`+`getPart` → `setActiveDocument`
     with `{kind:'part'}` carrying the kernel-returned part.
   - assembly: pointer `kind:'assembly'` → `unpackAssembly` → `setActiveDocument` `{kind:'assembly'}`.
   - drawing: unchanged path still works.
   - missing file → `clearLastOpen` + returns `false`.
   - part `execute` failure → `clearLastOpen` + `false` (no setActiveDocument).
3. **Autosave sets-not-clears**: the part/assembly autosave is an *inline* effect in `App.tsx`
   (not a standalone module like `autosaveDrawing.ts`), so it is not cleanly unit-testable in
   isolation. Prefer to cover "set-not-clear" end-to-end via the e2e (test 4 — reload restores the
   part/assembly, which can only happen if the pointer was set). Do NOT extract the inline effect
   into a new module solely to unit-test it (scope creep); a focused unit test is optional only if
   a no-churn seam already exists.
4. **Real-environment e2e (the §6 gate, real Chromium)**: create/edit a PART → trigger autosave →
   reload the page → assert the part is the active document AND editable (kernel warm: e.g. a
   feature-tree operation succeeds, or the viewport shows geometry). Repeat for an ASSEMBLY. Read
   the browser console; fail on errors. Verify teeth: with the pointer cleared (or the
   set-not-clear change reverted), reload restores nothing.

## Files touched (anticipated)

- `packages/app/src/storage/lastOpenDocument.ts` — kind-aware type + unified setter
- `packages/app/src/drawing/autosaveDrawing.ts` — use `setLastOpenDocument`
- `packages/app/src/drawing/restoreLastOpenDrawing.ts` → rename to `restoreLastOpenDocument.ts` +
  kind dispatch (update imports/usages)
- `packages/app/src/App.tsx` — autosave: set-not-clear for part/assembly; boot: call generalized restore
- tests + 1 real-env e2e

## Open risks / verification notes

- **Part kernel-id consistency**: the restore must use `getPart(partId)` so `activeDocument.document.id`
  equals the kernel's id (editable). Verify `kernel.loadFromBytes`/`getPart` exist on the client and
  round-trip an editable part from `saveToBytes` bytes (the autosave producer). The plan/verifier
  must confirm these method names against the real `KernelClient`.
- **Assembly component resolution on restore**: restored assemblies reference component parts by
  path; if a component path no longer resolves in OPFS, behavior matches File→Open (partial/empty
  component) — acceptable, not a regression.
- **e2e teeth**: a restore test that always restores (even if the feature regressed) is vacuous —
  verify by reverting the set-not-clear change and confirming reload restores nothing.
- **Rename churn**: `restoreLastOpenDrawing` has existing test(s)/imports; the rename must update all
  references (and the existing T-6-20 drawing-restore e2e must stay green).
