# Drawing OPFS Autosave + Reload-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drawing edits are continuously autosaved to OPFS, and on page reload the last-open drawing reappears in the viewport (with its projection source re-warmed so Regenerate works).

**Architecture:** Three bounded units: (1) a pure localStorage pointer module (`lastOpenDocument.ts`), (2) a pure async restore function (`restoreLastOpenDrawing.ts`), and (3) two wiring points in App.tsx — the existing autosave debounce effect (replace the `drawing` early-return with a minimal `autosaveDrawing()` call + additive `clearLastOpen()` lines in part/assembly branches) and a new startup effect (runs once after kernel is ready, guard: `activeDocument === null`). The part/assembly autosave bodies in App.tsx are NOT modified — they use React `useRef` closures (`partInfoCacheRef`, `panelSpecCacheRef`) that cannot be safely extracted. Only the new drawing-specific logic is isolated into a testable unit (`autosaveDrawing.ts`).

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), Zustand (`useAppStore`), OPFS (`packages/kernel/src/storage/Opfs.ts`), `packDrawing`/`unpackDrawing` from `packages/app/src/storage/DrawingPacker.ts`, `activateDrawingDocument` from `packages/app/src/drawing/activateDrawingDocument.ts`.

---

## Resolved open items (baked from real-code reads)

1. **Early-return line + scope:** `packages/app/src/App.tsx:3470` — `if (doc.kind === 'drawing') { return; }`. In scope: `opfs` (initialized at line 3467 via `if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator(); const opfs = opfsRef.current;`), `doc` = `useAppStore.getState().activeDocument` (line 3468), `autosaveStatsRef` (line 3445).
2. **Cold-boot guard:** `useAppStore.getState().activeDocument === null` at startup-effect fire time. The store initializes `activeDocument: null` (line 349 of `useAppStore.ts`). This is the correct guard — restore fires only when nothing is active yet.
3. **`activateDrawingDocument` sets both:** It calls `useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc })` (line 26) AND then sets `activeDrawingSourcePartId` + `activeDrawingSourceFingerprint` (or their assembly equivalents) in the store (lines 43–45 / 74–77), triggering DrawingCanvas's staleness useEffect. The restored drawing renders immediately; Regenerate is enabled when source loads successfully.
4. **localStorage key + test shim:** Key will be `'zilventor:lastOpenDocument'` (mirrors `showEdgeBands` guard pattern: `typeof localStorage !== 'undefined'`). `packages/app/src/test-setup.ts` installs a working in-memory `TestStorage` via `Object.defineProperty(globalThis, 'localStorage', …)` — this makes `lastOpenDocument.ts` fully testable under Vitest/Node 25.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/app/src/storage/lastOpenDocument.ts` | **Create** | Pure localStorage pointer: set/get/clear. No side effects. |
| `packages/app/src/storage/__tests__/lastOpenDocument.spec.ts` | **Create** | Unit tests for the pointer module (6 cases). |
| `packages/app/src/storage/autosaveDrawing.ts` | **Create** | Minimal pure async helper — drawing-only pack+write+pointer-set. Injected `{ doc, opfs, packDrawing }`. Does NOT touch part/assembly logic. |
| `packages/app/src/storage/__tests__/autosaveDrawing.spec.ts` | **Create** | Unit tests: writes correct path, packs correct bytes, calls setLastOpenDrawing (3 cases). |
| `packages/app/src/drawing/restoreLastOpenDrawing.ts` | **Create** | Async boot-restore: pointer→exists→read→unpack→activate. Clears pointer on missing/corrupt. Returns `boolean`. |
| `packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts` | **Create** | Unit tests: happy path (activateDrawingDocument called); missing file (clearLastOpen + false); corrupt bytes (clearLastOpen + false + no throw). |
| `packages/app/src/App.tsx` | **Modify** | (1) Import `autosaveDrawing`; replace the drawing early-return block with a call to it + `writeCount++`. Add one `clearLastOpen()` line after `opfs.write(…ziasm…)` in assembly branch and after `opfs.write(…zipt…)` in part branch. Part/assembly merge bodies byte-for-byte unchanged. (2) Add startup restore effect after kernel bootstrap. |
| `tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts` | **Create** | E2E: create drawing → base view → wait debounce → `page.reload()` → kernel ready → assert drawing + view restored. |

---

## BATCH B1: `lastOpenDocument.ts` — pointer module + unit tests

### Task 1: Create `lastOpenDocument.ts`

**Files:**
- Create: `packages/app/src/storage/__tests__/lastOpenDocument.spec.ts` (first — RED)
- Create: `packages/app/src/storage/lastOpenDocument.ts` (second — GREEN)

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/storage/__tests__/lastOpenDocument.spec.ts` (the implementation file does not exist yet):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { setLastOpenDrawing, getLastOpenDrawing, clearLastOpen } from '../lastOpenDocument';

// test-setup.ts installs a working in-memory localStorage shim for Node 25.
// No additional setup needed.

describe('lastOpenDocument', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('set → get round-trips the opfsPath', () => {
    setLastOpenDrawing('drawings/abc-123.zidw');
    const result = getLastOpenDrawing();
    expect(result).toEqual({ kind: 'drawing', opfsPath: 'drawings/abc-123.zidw' });
  });

  it('clearLastOpen removes the stored entry', () => {
    setLastOpenDrawing('drawings/abc-123.zidw');
    clearLastOpen();
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('returns null on corrupt JSON (does not throw)', () => {
    localStorage.setItem('zilventor:lastOpenDocument', '{bad json');
    expect(() => getLastOpenDrawing()).not.toThrow();
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('returns null when JSON is valid but wrong shape', () => {
    localStorage.setItem('zilventor:lastOpenDocument', JSON.stringify({ kind: 'part', id: 'x' }));
    expect(getLastOpenDrawing()).toBeNull();
  });

  it('second setLastOpenDrawing overwrites previous value', () => {
    setLastOpenDrawing('drawings/old.zidw');
    setLastOpenDrawing('drawings/new.zidw');
    expect(getLastOpenDrawing()).toEqual({ kind: 'drawing', opfsPath: 'drawings/new.zidw' });
  });
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
pnpm --filter app test:unit -- packages/app/src/storage/__tests__/lastOpenDocument.spec.ts
```

Expected: FAIL — `Cannot find module '../lastOpenDocument'`. This is the correct RED: the module does not exist yet, not an import typo.

- [ ] **Step 3: Create the implementation file**

Create `packages/app/src/storage/lastOpenDocument.ts`:

```typescript
// packages/app/src/storage/lastOpenDocument.ts

const LAST_OPEN_KEY = 'zilventor:lastOpenDocument';

export type LastOpenDocument = { kind: 'drawing'; opfsPath: string };

export function setLastOpenDrawing(opfsPath: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_OPEN_KEY, JSON.stringify({ kind: 'drawing', opfsPath }));
}

export function getLastOpenDrawing(): LastOpenDocument | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_OPEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['kind'] === 'drawing' &&
      typeof (parsed as Record<string, unknown>)['opfsPath'] === 'string'
    ) {
      return parsed as LastOpenDocument;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLastOpen(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LAST_OPEN_KEY);
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
pnpm --filter app test:unit -- packages/app/src/storage/__tests__/lastOpenDocument.spec.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Run full unit suite to confirm no regressions**

```bash
pnpm --filter app test:unit
```

Expected: all existing tests pass (baseline ≥1721; count may be higher if prior work added tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/storage/lastOpenDocument.ts packages/app/src/storage/__tests__/lastOpenDocument.spec.ts
git commit -m "feat(drawing-autosave): add lastOpenDocument pointer module (localStorage set/get/clear)"
```

---

## BATCH B2: `autosaveDrawing.ts` — drawing-only autosave helper + App.tsx wiring

This batch adds a minimal drawing-only helper and wires it into App.tsx. The part/assembly autosave bodies in App.tsx are NOT modified — they use `partInfoCacheRef.current` / `panelSpecCacheRef.current` React `useRef` closures and must stay inline. Only two additive `clearLastOpen()` lines are inserted after each of their existing `opfs.write` calls.

### Task 2: Create `autosaveDrawing.ts` and wire App.tsx

**Files:**
- Create: `packages/app/src/storage/__tests__/autosaveDrawing.spec.ts` (first — RED)
- Create: `packages/app/src/storage/autosaveDrawing.ts` (second — GREEN)
- Modify: `packages/app/src/App.tsx` (import + replace drawing early-return + additive clearLastOpen lines)

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/storage/__tests__/autosaveDrawing.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lastOpenDocument', () => ({
  setLastOpenDrawing: vi.fn(),
}));

import { setLastOpenDrawing } from '../lastOpenDocument';
import { autosaveDrawing } from '../autosaveDrawing';
import type { DrawingDocument } from '@zilventor/shared';

function makeOpfs() {
  return { write: vi.fn().mockResolvedValue(undefined) };
}

const baseDrawingDoc: DrawingDocument = {
  id: 'drw-aabb',
  name: 'My Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

describe('autosaveDrawing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes packed bytes to drawings/<id>.zidw', async () => {
    const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30]));
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(mockPackDrawing).toHaveBeenCalledWith(baseDrawingDoc);
    expect(opfs.write).toHaveBeenCalledWith('drawings/drw-aabb.zidw', new Uint8Array([10, 20, 30]));
  });

  it('calls setLastOpenDrawing with the write path', async () => {
    const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(setLastOpenDrawing).toHaveBeenCalledWith('drawings/drw-aabb.zidw');
  });

  it('writes the exact bytes returned by packDrawing (no mutation)', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const mockPackDrawing = vi.fn().mockResolvedValue(payload);
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(opfs.write).toHaveBeenCalledWith('drawings/drw-aabb.zidw', payload);
  });
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
pnpm --filter app test:unit -- packages/app/src/storage/__tests__/autosaveDrawing.spec.ts
```

Expected: FAIL — `Cannot find module '../autosaveDrawing'`.

- [ ] **Step 3: Create `autosaveDrawing.ts`**

Create `packages/app/src/storage/autosaveDrawing.ts`:

```typescript
/**
 * Drawing-only autosave helper. Called from App.tsx's autosave debounce effect
 * when activeDocument.kind === 'drawing'. Pure and injected — no React deps.
 *
 * Does NOT handle part or assembly autosave; those remain inline in App.tsx
 * because they depend on partInfoCacheRef / panelSpecCacheRef React closures.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { setLastOpenDrawing } from './lastOpenDocument';

export interface AutosaveDrawingOptions {
  doc: DrawingDocument;
  opfs: { write(path: string, bytes: Uint8Array): Promise<void> };
  packDrawing: (doc: DrawingDocument) => Promise<Uint8Array>;
}

export async function autosaveDrawing({ doc, opfs, packDrawing }: AutosaveDrawingOptions): Promise<void> {
  const bytes = await packDrawing(doc);
  const path = `drawings/${doc.id}.zidw`;
  await opfs.write(path, bytes);
  setLastOpenDrawing(path);
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
pnpm --filter app test:unit -- packages/app/src/storage/__tests__/autosaveDrawing.spec.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Wire `autosaveDrawing` into App.tsx**

Open `packages/app/src/App.tsx`.

**Add imports** near line 88 (after the existing `packAssembly` import):

```typescript
import { packDrawing } from './storage/DrawingPacker';
import { autosaveDrawing } from './storage/autosaveDrawing';
import { clearLastOpen } from './storage/lastOpenDocument';
```

**Replace the drawing early-return block.** Locate this exact block at App.tsx ~3470–3473:

```typescript
          if (doc.kind === 'drawing') {
            // TODO Sub-project 6: drawing autosave (.zidw)
            return;
          }
```

Replace it with:

```typescript
          if (doc.kind === 'drawing') {
            await autosaveDrawing({ doc: doc.document, opfs, packDrawing });
            autosaveStatsRef.current.writeCount += 1;
            return;
          }
```

**Add `clearLastOpen()` in the assembly branch.** Locate this exact line at App.tsx ~3510:

```typescript
            await opfs.write(`${doc.document.name}.ziasm`, archive);
```

Change it to (the only edit in this branch):

```typescript
            await opfs.write(`${doc.document.name}.ziasm`, archive);
            clearLastOpen();
```

**Add `clearLastOpen()` in the part branch.** Locate this exact line at App.tsx ~3514:

```typescript
            await opfs.write(`${doc.document.name}.zipt`, bytes);
```

Change it to (the only edit in this branch):

```typescript
            await opfs.write(`${doc.document.name}.zipt`, bytes);
            clearLastOpen();
```

> All other lines in the assembly branch (subAssemblyDocsSnapshot, cacheAdapter, mergeAndPruneBom, leafPartPaths loop, aggregateCutListRecursive, mergeAndPruneCutList, mergeAndPruneColorOverrides, packAssembly call) are byte-for-byte unchanged.

- [ ] **Step 6: Run full unit suite**

```bash
pnpm --filter app test:unit
```

Expected: all tests PASS. The autosaveDrawing unit tests must be GREEN.

- [ ] **Step 7: Typecheck**

```bash
pnpm -r typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/storage/autosaveDrawing.ts \
        packages/app/src/storage/__tests__/autosaveDrawing.spec.ts \
        packages/app/src/App.tsx
git commit -m "feat(drawing-autosave): wire drawing autosave + clearLastOpen on part/assembly via autosaveDrawing helper"
```

---

## BATCH B3: `restoreLastOpenDrawing.ts` — boot restore function + unit tests

### Task 3: Create `restoreLastOpenDrawing.ts`

**Files:**
- Create: `packages/app/src/drawing/restoreLastOpenDrawing.ts`
- Create: `packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage/lastOpenDocument', () => ({
  getLastOpenDrawing: vi.fn(),
  clearLastOpen: vi.fn(),
}));

vi.mock('../../storage/DrawingPacker', () => ({
  unpackDrawing: vi.fn(),
}));

vi.mock('../activateDrawingDocument', () => ({
  activateDrawingDocument: vi.fn().mockResolvedValue(undefined),
}));

import { getLastOpenDrawing, clearLastOpen } from '../../storage/lastOpenDocument';
import { unpackDrawing } from '../../storage/DrawingPacker';
import { activateDrawingDocument } from '../activateDrawingDocument';
import { restoreLastOpenDrawing } from '../restoreLastOpenDrawing';
import type { DrawingDocument } from '@zilventor/shared';

const baseDrawingDoc: DrawingDocument = {
  id: 'drw-restore',
  name: 'Restored Drawing',
  units: 'mm',
  source: { partPath: 'parts/cab.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

function makeOpfs(existsResult = true) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    write: vi.fn(),
    delete: vi.fn(),
    listAll: vi.fn(),
  };
}

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-id'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('restoreLastOpenDrawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false immediately when getLastOpenDrawing returns null', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(false);
    expect(opfs.exists).not.toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('happy path: reads OPFS file, unpacks, activates, returns true', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/drw-restore.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(baseDrawingDoc);
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(true);
    expect(opfs.exists).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(opfs.read).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(unpackDrawing).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(activateDrawingDocument).toHaveBeenCalledWith(baseDrawingDoc, {
      kernel: kernel,
      opfs: opfs,
    });
    expect(clearLastOpen).not.toHaveBeenCalled();
  });

  it('OPFS file missing: clears pointer, returns false, does not call activateDrawingDocument', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/ghost.zidw',
    });
    const opfs = makeOpfs(false); // exists = false
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(false);
    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('corrupt bytes (unpackDrawing throws): clears pointer, returns false, does not throw', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/corrupt.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DrawingPacker: malformed manifest.json'),
    );
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    await expect(
      restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never }),
    ).resolves.toBe(false);

    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts
```

Expected: FAIL — `Cannot find module '../restoreLastOpenDrawing'`.

- [ ] **Step 3: Create `restoreLastOpenDrawing.ts`**

Create `packages/app/src/drawing/restoreLastOpenDrawing.ts`:

```typescript
/**
 * Boot-restore helper. Called once on cold-boot after kernel+opfs are ready.
 * Reads the last-open pointer from localStorage, loads the .zidw from OPFS,
 * unpacks it, and activates the drawing document.
 *
 * Returns true on success, false on any graceful failure (no pointer, file
 * missing, corrupt bytes). Never throws — a failed restore must not crash the app.
 */
import { getLastOpenDrawing, clearLastOpen } from '../storage/lastOpenDocument';
import { unpackDrawing } from '../storage/DrawingPacker';
import { activateDrawingDocument } from './activateDrawingDocument';
import type { KernelForLoad, OpfsForLoad } from './loadDrawingSource';

export async function restoreLastOpenDrawing({
  kernel,
  opfs,
}: {
  kernel: KernelForLoad;
  opfs: OpfsForLoad;
}): Promise<boolean> {
  const pointer = getLastOpenDrawing();
  if (!pointer) return false;

  try {
    const exists = await opfs.exists(pointer.opfsPath);
    if (!exists) {
      clearLastOpen();
      return false;
    }

    const bytes = await opfs.read(pointer.opfsPath);
    const doc = await unpackDrawing(bytes);
    await activateDrawingDocument(doc, { kernel, opfs });
    return true;
  } catch {
    clearLastOpen();
    return false;
  }
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
pnpm --filter app test:unit -- packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run full unit suite**

```bash
pnpm --filter app test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm -r typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/drawing/restoreLastOpenDrawing.ts \
        packages/app/src/drawing/__tests__/restoreLastOpenDrawing.spec.ts
git commit -m "feat(drawing-autosave): add restoreLastOpenDrawing boot-restore function"
```

---

## BATCH B4: App.tsx startup effect + e2e T-6-20

### Task 4: Wire startup restore effect in App.tsx

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add the import for `restoreLastOpenDrawing` in App.tsx**

Near line 118 (after the `renderDrawingPdf` import), add:

```typescript
import { restoreLastOpenDrawing } from './drawing/restoreLastOpenDrawing';
```

- [ ] **Step 2: Add the startup restore effect in App.tsx**

Place this effect immediately after the kernel bootstrap effect (after line 958, `}, []);`), before the "Re-execute when the feature tree…" comment at line 960:

```typescript
  // Drawing OPFS autosave: boot-restore effect.
  // Runs once after the kernel becomes ready. Guards on activeDocument === null
  // so a user action that opens a doc before this effect fires is never clobbered.
  useEffect(() => {
    if (!kernelReady) return;
    if (useAppStore.getState().activeDocument !== null) return;
    void (async () => {
      try {
        if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
        await restoreLastOpenDrawing({
          kernel: useAppStore.getState().kernel as never,
          opfs: opfsRef.current,
        });
      } catch (e) {
        console.warn('boot restore failed:', (e as Error).message);
      }
    })();
  }, [kernelReady]);
```

> `kernelReady` is already in scope: `const kernelReady = useAppStore((s) => s.kernelReady);` at line 352 of App.tsx.
> `opfsRef` is declared at line 3225 of App.tsx as `const opfsRef = useRef<Opfs | null>(null);` — it is **outside** the startup effect's closure, so the boot effect references the same singleton used by the autosave and placement effects.

- [ ] **Step 3: Run full unit suite to confirm no regressions**

```bash
pnpm --filter app test:unit
```

Expected: all tests pass. The App.spec.tsx stubs Opfs already (line 32 comment in App.spec.tsx); no new mocking needed for the startup effect since it only calls `restoreLastOpenDrawing` which is separately covered.

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm -r typecheck && pnpm lint
```

Expected: 0 errors, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(drawing-autosave): wire startup restore effect in App.tsx (cold-boot drawing reload)"
```

---

### Task 5: e2e T-6-20 — autosave + page.reload() round-trip

**Files:**
- Create: `tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts`

- [ ] **Step 1: Write the e2e test (it will fail until autosave+restore are wired — confirm RED first)**

Create `tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts`:

```typescript
// tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts
/**
 * T-6-20 — Drawing OPFS autosave + reload recovery.
 *
 * End-to-end proof of the full loop:
 *   1. Build a real box (50×50×30).
 *   2. Save box bytes to OPFS at a stable path ('drawing-source-t620.zipt').
 *   3. CreateDrawingCommand (sourced from that path) + AddBaseViewCommand.
 *   4. Wait ≥500ms for the autosave debounce to fire and write drawings/<id>.zidw to OPFS
 *      AND set the localStorage pointer 'zilventor:lastOpenDocument'.
 *   5. page.reload() → waitForKernelReady (status bar shows 'Ready' or 'Opened').
 *   6. Assert: the drawing and its base view are restored in the viewport
 *      ([data-sheet-border] visible; g[data-view-id] present and contains polylines).
 *
 * Import idiom: `await import('/src/...')` inside page.evaluate — drawing commands
 * are NOT window-exposed (per file-reopen lesson from T-6-15).
 *
 * Reload pattern: page.reload() + waitForKernelReady (status bar 'Ready').
 * The boot restore effect runs after kernelReady = true fires; it calls
 * restoreLastOpenDrawing → unpackDrawing → activateDrawingDocument → setActiveDocument.
 * DrawingCanvas mounts when activeDocument.kind === 'drawing'.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-20: drawing autosave + reload recovery — drawing + view restored after page.reload()', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(90_000);

  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build a 50×50×30 box part.
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // 2. Save box bytes to OPFS at a stable path for CreateDrawingCommand.
  const SOURCE_PATH = 'drawing-source-t620.zipt';
  await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: { execute(id: string): Promise<unknown>; saveToBytes(id: string): Promise<Uint8Array> } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-20 step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
    },
    { sourcePath: SOURCE_PATH },
  );

  // 3. Create drawing sourced from the real OPFS path + add base view.
  const { drawingId, baseViewId } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: { id: string; sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> };
            } | null;
          };
        };
      }).__zilventorStore;

      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const afterCreate = store.getState();
      const drawingId = afterCreate.activeDocument!.document.id;
      const sheetId = afterCreate.activeDocument!.document.sheets[0]!.id;

      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
      const baseView = doc2?.sheets[0]?.views.find((v) => v.kind === 'base');
      if (!baseView) throw new Error('T-6-20: base view not found after AddBaseViewCommand');
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-20: base view has no projected edges');
      }

      return { drawingId, baseViewId: baseView.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // 4. Wait for autosave debounce (500ms) + OPFS write to complete.
  //    Poll localStorage until the pointer appears — fires the instant autosave commits.
  //    This is deterministic; page.waitForTimeout is explicitly avoided.
  await page.waitForFunction(
    () => !!localStorage.getItem('zilventor:lastOpenDocument'),
    undefined,
    { timeout: 10_000 },
  );

  const autosaveVerified = await page.evaluate(
    async ({ expectedDrawingId }: { expectedDrawingId: string }) => {
      // Check localStorage pointer
      const raw = localStorage.getItem('zilventor:lastOpenDocument');
      if (!raw) return { ok: false, reason: 'localStorage pointer not set' };
      let pointer: unknown;
      try { pointer = JSON.parse(raw); } catch { return { ok: false, reason: 'localStorage pointer not valid JSON' }; }
      const p = pointer as Record<string, unknown>;
      if (p['kind'] !== 'drawing') return { ok: false, reason: `pointer kind is ${p['kind']}` };
      const opfsPath = p['opfsPath'] as string;
      if (!opfsPath.includes(expectedDrawingId)) {
        return { ok: false, reason: `opfsPath ${opfsPath} does not include drawing id ${expectedDrawingId}` };
      }

      // Check OPFS file exists
      try {
        const root = await navigator.storage.getDirectory();
        const parts = opfsPath.split('/').filter((x: string) => x.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
      } catch {
        return { ok: false, reason: `OPFS file ${opfsPath} not found` };
      }

      return { ok: true, reason: '', opfsPath };
    },
    { expectedDrawingId: drawingId },
  );

  expect(autosaveVerified.ok, `Autosave not verified: ${autosaveVerified.reason}`).toBe(true);

  // 5. Reload the page. The boot-restore effect fires after kernelReady.
  await page.reload();
  // waitForKernelReady waits for status bar 'Ready'. After restore, status shows 'Opened'.
  // Either is acceptable — use a broader selector that matches both.
  await expect(page.getByText(/^(Ready|Opened)$/)).toBeVisible({ timeout: 120_000 });

  // 6. Switch to Drawing tab (boot restore activates the drawing, DrawingCanvas mounts).
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // 7. Assert sheet border visible (drawing rendered).
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // 8. Assert base view present (view id survived the pack→unpack round-trip).
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 15_000 });

  // 9. Assert the view contains real projected edges (polylines).
  const edgeCount = await page
    .locator(`g[data-view-id="${baseViewId}"] polyline`)
    .count();
  expect(edgeCount, 'restored view must have projected edges').toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the e2e to confirm RED (before Batches B1-B4 are wired)**

  If running in order (Batches B1–B3 already committed), autosave is wired but the startup restore effect is wired in Task 4 (B4). Both must be in place for T-6-20 to go GREEN. Run only after Task 4 (startup effect) is committed.

```bash
pnpm test:e2e -- tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts
```

Expected initially (before B4 commit): test reaches the reload step but no drawing is restored — assertion `page.locator('[data-sheet-border]')` times out. This is the expected RED.

After B4 is committed (startup effect in App.tsx), re-run:

```bash
pnpm test:e2e -- tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts
```

Expected: PASS — drawing + base view visible after reload.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

```bash
pnpm test:e2e
```

Expected: all existing drawing e2e tests pass; T-6-20 is GREEN.

- [ ] **Step 4: Run full unit suite one final time**

```bash
pnpm --filter app test:unit
```

Expected: all tests PASS (≥1727 tests: baseline 1721 + 6 lastOpenDocument + 3 autosaveDrawing + 4 restoreLastOpenDrawing = 1734 minimum; exact count depends on pre-existing test additions).

- [ ] **Step 5: Final typecheck + lint**

```bash
pnpm -r typecheck && pnpm lint
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/drawing/T-6-20-drawing-opfs-autosave-reload.spec.ts \
        packages/app/src/App.tsx
git commit -m "feat(drawing-autosave): e2e T-6-20 — autosave + page.reload() recovery round-trip"
```

---

## Summary

| Batch | Tasks | New test files | New source files | App.tsx changes |
|---|---|---|---|---|
| B1 | 1 | `lastOpenDocument.spec.ts` (6 tests) | `lastOpenDocument.ts` | — |
| B2 | 1 | `autosaveDrawing.spec.ts` (3 tests) | `autosaveDrawing.ts` | replace drawing early-return; add `clearLastOpen()` after assembly write + after part write |
| B3 | 1 | `restoreLastOpenDrawing.spec.ts` (4 tests) | `restoreLastOpenDrawing.ts` | — |
| B4 | 2 | `T-6-20-drawing-opfs-autosave-reload.spec.ts` (1 e2e) | — | add `restoreLastOpenDrawing` import + startup effect |

**Total new unit tests:** 13 (6 + 3 + 4). **New e2e:** 1.
**Part/assembly autosave in App.tsx:** unchanged except two additive `clearLastOpen()` lines.
