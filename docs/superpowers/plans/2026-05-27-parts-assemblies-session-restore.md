# Parts/assemblies Session-Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On reload, restore the last-open document of any kind (part, assembly, or drawing), re-warming the kernel so a restored part/assembly is immediately editable.

**Architecture:** The bytes already autosave to OPFS for all three kinds; only the last-open pointer + restore path are drawing-scoped. Generalize the pointer to be kind-aware, switch the part/assembly autosave branches from `clearLastOpen()` to `setLastOpenDocument(...)`, and generalize `restoreLastOpenDrawing` → `restoreLastOpenDocument` to dispatch on kind (mirroring File→Open's loaders exactly). No new autosave plumbing; no manifest/schema change.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Vitest, Playwright e2e (Chromium), Zustand store, OCCT kernel via Comlink, OPFS, localStorage.

**Test commands (from repo root):**
- app: `pnpm --filter app exec vitest run <path-relative-to-packages/app>`
- full gate: `pnpm -r test:unit`
- e2e: `pnpm test:e2e -- tests/e2e/<spec> --project=chromium`

**Reference, not literal:** code blocks mirror current code; verify exact imports/identifiers/line numbers against the real files before re-emitting.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/app/src/storage/lastOpenDocument.ts` | kind-aware pointer + generic setter/getter | modify |
| `packages/app/src/drawing/restoreLastOpenDrawing.ts` → `restoreLastOpenDocument.ts` | kind-dispatching boot restore | rename + modify |
| `packages/app/src/App.tsx` | boot: call generalized restore; autosave: set-not-clear for part/assembly | modify |
| `tests/e2e/drawing/<new>.spec.ts` | real-env part + assembly restore | create |

---

## Task 1: Kind-aware `lastOpenDocument`

**Files:**
- Modify: `packages/app/src/storage/lastOpenDocument.ts`
- Test: `packages/app/src/storage/__tests__/lastOpenDocument.spec.ts` (extend existing)

- [ ] **Step 1: Write the failing tests**

Add to the existing `lastOpenDocument.spec.ts` (which already has `beforeEach(() => localStorage.clear())`):

```typescript
import { setLastOpenDocument, getLastOpenDocument } from '../lastOpenDocument';

it('setLastOpenDocument round-trips a part pointer', () => {
  setLastOpenDocument({ kind: 'part', opfsPath: 'Cabinet.zipt' });
  expect(getLastOpenDocument()).toEqual({ kind: 'part', opfsPath: 'Cabinet.zipt' });
});

it('setLastOpenDocument round-trips an assembly pointer', () => {
  setLastOpenDocument({ kind: 'assembly', opfsPath: 'Kitchen.ziasm' });
  expect(getLastOpenDocument()).toEqual({ kind: 'assembly', opfsPath: 'Kitchen.ziasm' });
});

it('getLastOpenDocument reads a legacy drawing pointer', () => {
  setLastOpenDocument({ kind: 'drawing', opfsPath: 'drawings/d1.zidw' });
  expect(getLastOpenDocument()).toEqual({ kind: 'drawing', opfsPath: 'drawings/d1.zidw' });
});

it('getLastOpenDocument returns null on an unknown kind', () => {
  localStorage.setItem('zilventor:lastOpenDocument', JSON.stringify({ kind: 'widget', opfsPath: 'x' }));
  expect(getLastOpenDocument()).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter app exec vitest run src/storage/__tests__/lastOpenDocument.spec.ts`
Expected: FAIL — `setLastOpenDocument`/`getLastOpenDocument` not exported.

- [ ] **Step 3: Implement**

In `lastOpenDocument.ts`, widen the type and add the generic functions; KEEP `setLastOpenDrawing` as a thin wrapper and KEEP `getLastOpenDrawing` + `clearLastOpen` unchanged (so existing callers + tests need no change):

```typescript
const LAST_OPEN_KEY = 'zilventor:lastOpenDocument';

export type LastOpenKind = 'drawing' | 'part' | 'assembly';
export type LastOpenDocument = { kind: LastOpenKind; opfsPath: string };

export function setLastOpenDocument(ptr: LastOpenDocument): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_OPEN_KEY, JSON.stringify(ptr));
}

export function getLastOpenDocument(): LastOpenDocument | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_OPEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if ((p.kind === 'drawing' || p.kind === 'part' || p.kind === 'assembly') && typeof p.opfsPath === 'string') {
      return { kind: p.kind, opfsPath: p.opfsPath };
    }
    return null;
  } catch {
    return null;
  }
}

// Thin wrapper — keeps the existing drawing autosave caller + tests unchanged.
export function setLastOpenDrawing(opfsPath: string): void {
  setLastOpenDocument({ kind: 'drawing', opfsPath });
}

export function getLastOpenDrawing(): LastOpenDocument | null {
  const p = getLastOpenDocument();
  return p && p.kind === 'drawing' ? p : null;
}

export function clearLastOpen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LAST_OPEN_KEY);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter app exec vitest run src/storage/__tests__/lastOpenDocument.spec.ts`
Expected: PASS (new + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/storage/lastOpenDocument.ts packages/app/src/storage/__tests__/lastOpenDocument.spec.ts
git commit -m "feat(session-restore): kind-aware lastOpenDocument pointer"
```

---

## Task 2: Generalize restore → `restoreLastOpenDocument` (part + assembly + drawing)

**Files:**
- Rename: `packages/app/src/drawing/restoreLastOpenDrawing.ts` → `packages/app/src/drawing/restoreLastOpenDocument.ts`
- Modify: `packages/app/src/App.tsx` (import + boot call)
- Test: rename `restoreLastOpenDrawing.spec.ts` → `restoreLastOpenDocument.spec.ts` + add part/assembly cases

- [ ] **Step 1: Write the failing tests**

`git mv packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts packages/app/src/drawing/__tests__/restoreLastOpenDocument.spec.ts`. Update its imports (function name + module path → `../restoreLastOpenDocument`; `getLastOpenDrawing` mock → `getLastOpenDocument`). ADD `unpackAssembly` to the mocks and `getPart` to the kernel mock, import the real store, and reset it per-test:

```typescript
vi.mock('../../storage/lastOpenDocument', () => ({
  getLastOpenDocument: vi.fn(),
  clearLastOpen: vi.fn(),
}));
vi.mock('../../storage/DrawingPacker', () => ({ unpackDrawing: vi.fn() }));
vi.mock('@zilventor/kernel/src/storage/AssemblyPacker', () => ({ unpackAssembly: vi.fn() }));
vi.mock('../activateDrawingDocument', () => ({ activateDrawingDocument: vi.fn().mockResolvedValue(undefined) }));

import { getLastOpenDocument, clearLastOpen } from '../../storage/lastOpenDocument';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { useAppStore } from '../../store/useAppStore';
import { restoreLastOpenDocument } from '../restoreLastOpenDocument';

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ activeDocument: null, activePart: null, activeAssembly: null, activeDrawing: null } as never);
});

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-id'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
    getPart: vi.fn(), // set per-test
  };
}

it('part pointer: loadFromBytes→execute→getPart→setActiveDocument(part)', async () => {
  const partDoc = { id: 'kernel-part-id', name: 'Cabinet', units: 'mm', featureTree: [], materials: [] };
  (getLastOpenDocument as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ kind: 'part', opfsPath: 'Cabinet.zipt' });
  const kernel = makeKernel();
  kernel.getPart.mockResolvedValue(partDoc);
  const opfs = makeOpfs(true);

  const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs });

  expect(ok).toBe(true);
  expect(kernel.loadFromBytes).toHaveBeenCalled();
  expect(kernel.execute).toHaveBeenCalledWith('kernel-part-id');
  expect(kernel.getPart).toHaveBeenCalledWith('kernel-part-id');
  const active = useAppStore.getState().activeDocument;
  expect(active?.kind).toBe('part');
  expect((active as { document: unknown }).document).toBe(partDoc);
});

it('assembly pointer: unpackAssembly→setActiveDocument(assembly), no kernel load', async () => {
  const asmDoc = { id: 'asm1', name: 'Kitchen', components: [], materials: [] };
  (getLastOpenDocument as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ kind: 'assembly', opfsPath: 'Kitchen.ziasm' });
  (unpackAssembly as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(asmDoc);
  const kernel = makeKernel();
  const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs: makeOpfs(true) });
  expect(ok).toBe(true);
  expect(kernel.loadFromBytes).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
  expect((useAppStore.getState().activeDocument as { document: unknown }).document).toBe(asmDoc);
});

it('part pointer: execute failure clears pointer, returns false, no setActiveDocument', async () => {
  (getLastOpenDocument as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ kind: 'part', opfsPath: 'Cabinet.zipt' });
  const kernel = makeKernel();
  kernel.execute.mockResolvedValue({ ok: false, error: 'boom' });
  const ok = await restoreLastOpenDocument({ kernel: kernel as never, opfs: makeOpfs(true) });
  expect(ok).toBe(false);
  expect(clearLastOpen).toHaveBeenCalled();
  expect(useAppStore.getState().activeDocument).toBeNull();
});
```

Keep the EXISTING drawing-path tests (update only the function/module name + the `getLastOpenDrawing`→`getLastOpenDocument` mock symbol). The drawing happy-path test should now make `getLastOpenDocument` return `{ kind:'drawing', opfsPath }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/restoreLastOpenDocument.spec.ts`
Expected: FAIL — `restoreLastOpenDocument` module does not exist yet.

- [ ] **Step 3: Implement the rename + dispatch**

`git mv packages/app/src/drawing/restoreLastOpenDrawing.ts packages/app/src/drawing/restoreLastOpenDocument.ts`, then rewrite:

```typescript
/**
 * Boot-restore helper. Reads the last-open pointer, loads the doc from OPFS, and
 * activates it. Dispatches on kind: drawing | part | assembly. Never throws —
 * a failed restore must not crash the app.
 */
import type { PartDocument } from '@zilventor/shared';
import { getLastOpenDocument, clearLastOpen } from '../storage/lastOpenDocument';
import { unpackDrawing } from '../storage/DrawingPacker';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { activateDrawingDocument } from './activateDrawingDocument';
import { useAppStore } from '../store/useAppStore';
import type { OpfsForLoad } from './loadDrawingSource';

export type KernelForRestore = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; error?: unknown }>;
  getPart(partId: string): Promise<PartDocument>;
};

export async function restoreLastOpenDocument({
  kernel,
  opfs,
}: {
  kernel: KernelForRestore;
  opfs: OpfsForLoad;
}): Promise<boolean> {
  const pointer = getLastOpenDocument();
  if (!pointer) return false;

  try {
    const exists = await opfs.exists(pointer.opfsPath);
    if (!exists) {
      clearLastOpen();
      return false;
    }
    const bytes = await opfs.read(pointer.opfsPath);

    if (pointer.kind === 'drawing') {
      const doc = await unpackDrawing(bytes);
      // KernelForRestore is a structural superset of activateDrawingDocument's KernelForLoad.
      await activateDrawingDocument(doc, { kernel, opfs });
      return true;
    }

    if (pointer.kind === 'assembly') {
      const doc = await unpackAssembly(bytes);
      useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
      return true;
    }

    // part
    const partId = await kernel.loadFromBytes(bytes);
    const res = await kernel.execute(partId);
    if (!res.ok) {
      clearLastOpen();
      return false;
    }
    const part = await kernel.getPart(partId);
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    return true;
  } catch {
    clearLastOpen();
    return false;
  }
}
```

If `activateDrawingDocument(doc, { kernel, opfs })` type-errors because `KernelForRestore` isn't assignable to its `KernelForLoad` param, pass `{ kernel: kernel as unknown as Parameters<typeof activateDrawingDocument>[1]['kernel'], opfs }` (it is structurally a superset, so it should assign directly — only cast if the compiler disagrees).

Then in `App.tsx`: change the import `import { restoreLastOpenDrawing } from './drawing/restoreLastOpenDrawing';` → `import { restoreLastOpenDocument, type KernelForRestore } from './drawing/restoreLastOpenDocument';`, and in the boot effect change the call to `restoreLastOpenDocument({ kernel: kernel as unknown as KernelForRestore, opfs: opfsRef.current })`. (Remove the now-unused `KernelForLoad` import if it was only used for that cast.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter app exec vitest run src/drawing/__tests__/restoreLastOpenDocument.spec.ts`
Expected: PASS (drawing + part + assembly + error cases).

- [ ] **Step 5: Typecheck the app (the rename + App.tsx wiring)**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: clean. Fix any dangling `restoreLastOpenDrawing` reference the compiler flags.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(session-restore): restoreLastOpenDocument dispatches part/assembly/drawing"
```

---

## Task 3: Autosave set-not-clear for part & assembly (App.tsx)

**Files:**
- Modify: `packages/app/src/App.tsx` (autosave branches ~3688, ~3694)

**No-TDD exception** (CLAUDE.md §4a): this is a 2-line change to an *inline* autosave effect that depends on React closures and is not cleanly unit-testable. It is verified by typecheck (Step 2) + the real-env e2e (Task 4).

- [ ] **Step 1: Implement**

Add `setLastOpenDocument` to the App.tsx import from `./storage/lastOpenDocument` (keep `clearLastOpen` — still used by the boot/restore failure paths). In the autosave effect, replace the two `clearLastOpen()` calls:

```typescript
// assembly branch (after `await opfs.write(`${doc.document.name}.ziasm`, archive);`):
setLastOpenDocument({ kind: 'assembly', opfsPath: `${doc.document.name}.ziasm` });

// part branch (after `await opfs.write(`${doc.document.name}.zipt`, bytes);`):
setLastOpenDocument({ kind: 'part', opfsPath: `${doc.document.name}.zipt` });
```

(The drawing branch already sets the pointer via `autosaveDrawing` → `setLastOpenDrawing` → `setLastOpenDocument`.)

- [ ] **Step 2: Typecheck + full app unit suite (regression)**

Run: `pnpm --filter app exec tsc --noEmit && pnpm --filter app exec vitest run`
Expected: clean + green (no existing test asserts `clearLastOpen` in the part/assembly autosave path; if one does, update it to expect the pointer is set).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(session-restore): part/assembly autosave sets last-open pointer (not clear)"
```

---

## Task 4: Real-environment e2e — part + assembly restore (the §6 gate)

**Files:**
- Create: `tests/e2e/drawing/session-restore-part-assembly.spec.ts`
- Test: this IS the test

- [ ] **Step 1: Write the e2e**

Mirror `tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts` (the drawing autosave+reload e2e) for setup/harness/reload mechanics. Two scenarios:

1. **Part restore:** create/open a PART in the real app (reuse whatever part-creation the existing part e2es use — e.g. a window/store helper or the UI ribbon). Make an edit (or just ensure it's the active doc) so the 500ms autosave fires; wait for the autosave (poll the OPFS write or wait > 500ms). `await page.reload()`. After reload + kernel-ready, assert:
   - `useAppStore.getState().activeDocument?.kind === 'part'` (read via `window.__zilventorStore` bridge),
   - the part is EDITABLE / kernel is warm — e.g. the part's geometry renders, or a kernel call on the active part id succeeds. Pick a concrete, observable signal (mirror how T-6-20 proves the drawing restored).
2. **Assembly restore:** same shape with an assembly → after reload `activeDocument?.kind === 'assembly'`.
3. Capture `page.on('console')`; FAIL on any console error; print console output.

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- tests/e2e/drawing/session-restore-part-assembly.spec.ts --project=chromium`
Expected: PASS, console clean. If a real production gap surfaces (e.g. the part's kernel id isn't consistent → not editable; or the boot effect fires before the autosave wrote), FIX the production code minimally (load `superpowers:systematic-debugging`) and report the gap + fix.

- [ ] **Step 3: Verify teeth (temporarily break the production path)**

Temporarily revert ONE of Task 3's `setLastOpenDocument(...)` back to `clearLastOpen()` (the part branch), re-run the e2e → the part-restore assertion must FAIL (reload restores nothing). Restore the change → re-run → PASS. Report both outcomes.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drawing/session-restore-part-assembly.spec.ts
git commit -m "test(session-restore): real-env e2e — part + assembly restored after reload"
```

---

## Task 5: Full gate + drawing-restore regression

**Files:** none (verification)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm -r typecheck`
Expected: clean across all 5 packages.

- [ ] **Step 2: Full unit suite**

Run: `pnpm -r test:unit`
Expected: green. Baseline 2986 (735 shared + 37 sketcher-worker + 350 kernel + 1864 app); expect app to rise by the new tests. A lone DrawingCanvas act() flake under `-r` re-runs green.

- [ ] **Step 3: Drawing-restore e2e regression (must stay green)**

Run: `pnpm test:e2e -- tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts --project=chromium`
Expected: PASS — generalizing the pointer/restore must not break drawing restore.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: 0 errors (16 warnings baseline). Run inside the worktree or after cleanup.

- [ ] **Step 5: Commit (only if fixups were needed)**

```bash
git add -A && git commit -m "chore(session-restore): typecheck/lint fixups"
```

---

## Self-review

**Spec coverage:**
- Kind-aware pointer + unified setter → Task 1. ✅
- Autosave set-not-clear for part/assembly → Task 3. ✅
- `restoreLastOpenDocument` part (loadFromBytes→execute→getPart→setActiveDocument) / assembly (unpackAssembly→setActiveDocument) / drawing (existing) dispatch → Task 2. ✅
- Boot effect calls generalized restore; `activeDocument===null` guard preserved → Task 2 (App.tsx wiring). ✅
- Error handling (missing file, part execute failure, corrupt bytes → clearLastOpen + boot empty) → Task 2 impl + tests. ✅
- Eager rehydration (kernel warm on boot for parts) → Task 2 part branch. ✅
- Mirror File→Open loaders → Task 2 (getPart for parts; unpackAssembly for assemblies). ✅
- Real-env e2e with teeth → Task 4. ✅
- Drawing-restore regression → Task 5 Step 3. ✅
- No manifest/schema change → confirmed (localStorage + runtime only). ✅
- Non-goals (name-based path collisions, multi-doc/session, view state) → untouched. ✅

**Placeholder scan:** no TBD/TODO; every code step shows code; e2e part-creation harness deferred to "mirror existing part e2es / T-6-20" (reference instruction, not a placeholder — concrete assertions + teeth are specified).

**Type consistency:** `LastOpenDocument = { kind: LastOpenKind; opfsPath: string }` consistent across setter/getter/callers; `setLastOpenDocument(ptr)` signature identical in Task 1/3; `restoreLastOpenDocument({kernel, opfs})` + `KernelForRestore` (`loadFromBytes`/`execute`/`getPart`) consistent in Task 2 module + App.tsx boot cast; `setActiveDocument({kind, document})` matches the store action.
