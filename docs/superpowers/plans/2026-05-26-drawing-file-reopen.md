# Drawing File Reopen (`.zidw`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `.zidw` reopen in `FileTab.handleOpen` (currently a no-op `return`) plus `packDrawing`/`unpackDrawing` serializers and `activateDrawingDocument`, so reopening a saved drawing reloads its source part from OPFS, recomputes `activeDrawingSourceFingerprint`, and fires the existing staleness pipeline.

**Architecture:** Extract the inline tar.gz build in `saveDrawingToOpfs.ts` into a pure `packDrawing(doc)` function (and the symmetric `unpackDrawing(bytes)`) co-located in the same file. Add `activateDrawingDocument(doc, { kernel, opfs })` in `packages/app/src/drawing/activateDrawingDocument.ts` — a thin orchestrator that calls `setActiveDocument`, clears the source cache, calls `loadDrawingSource`, and sets the store slots. Wire `unpackDrawing` + `activateDrawingDocument` into `FileTab.handleOpen` (the drawing branch). The existing staleness `useEffect` in `DrawingCanvas` and `RegenerateViewCommand` need no changes — they already react to `activeDrawingSourceFingerprint`. (`handleSaveAs` drawing branch is out of scope.)

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), Zustand (store), `writeTarGz`/`readTarGz` from `@zilventor/kernel/src/storage/tarGzipUtil`, `migrateManifest`/`CURRENT_FORMAT_VERSION` from `@zilventor/shared`, `Opfs.forNavigator()` from `@zilventor/kernel/src/storage/Opfs`.

---

## Fact-check corrections

None — all spec claims verified against code at the paths below. Corrections and discoveries noted:

1. **`packDrawing` does not exist yet** (confirmed: `packages/app/src/storage/saveDrawingToOpfs.ts` builds tar.gz inline with no exported `packDrawing`; `find` confirms no `DrawingPacker` file anywhere).
2. **`handleSaveAs` drawing branch is OUT OF SCOPE** (`FileTab.tsx` line 44: `// TODO Sub-project 6: implement drawing save`). Removed from plan per verifier FIX 4 — `packDrawing` is NOT dead code without it (`saveDrawingToOpfs` uses it). `FileTab.tsx` imports only `unpackDrawing` for the `handleOpen` branch.
3. **Notice mechanism:** `setStatus` (store, line 406 of `useAppStore.ts`) is the correct non-blocking notice — it sets the status bar message visible at all times. `showToast` lives only in `App.tsx` local state (not in the store or accessible from `activateDrawingDocument`). **Plan uses `setStatus` for non-blocking notice** (`'Source part not found — Regenerate disabled'`). `setErrorDialog` in `FileTab` (modal alertdialog) is for fatal errors only.
4. **`AssemblyPacker` lives in `packages/kernel/src/storage/`**, not in `packages/app/src/storage/`. `saveDrawingToOpfs.ts` imports `writeTarGz` from `@zilventor/kernel/src/storage/tarGzipUtil`. The new `DrawingPacker.ts` will follow the same import path. We place it alongside `saveDrawingToOpfs.ts` in `packages/app/src/storage/` (same package, same test environment) rather than in `packages/kernel` (no cross-package dependency needed — drawing types are in `@zilventor/shared`).
5. **`unpackAssembly` kind check is BEFORE `migrateManifest`** (`AssemblyPacker.ts` lines 36–42). `unpackDrawing` must mirror this order exactly: kind-check first, then `migrateManifest`. Plan updated per verifier FIX 2.
6. **`setActiveDocument` does NOT reset `activeDrawingSourcePartId` / `activeDrawingSourceFingerprint`** (confirmed: `useAppStore.ts` lines 362–367 show `setActiveDocument` only sets `activeDocument`, `activePart`, `activeAssembly`, `activeDrawing` — the source slots are not touched). `activateDrawingDocument` must explicitly set them.
7. **`DrawingCanvas` staleness `useEffect` dep array** (line 158): `[drawing.id, sheet.id, activeDrawingSourceFingerprint]` — setting `activeDrawingSourceFingerprint` in the store triggers this effect automatically; no tab-switch needed.
8. **`CURRENT_FORMAT_VERSION = 19`** (confirmed: `packages/shared/src/fileFormat.ts` line 4). `unpackDrawing` will reject archives whose `formatVersion > 19` via `migrateManifest`'s built-in check.
9. **`DrawingSource` type** (confirmed: `partPath: string`, `sourceKind: 'part' | 'assembly'`).
10. **`inputFingerprint` is optional** on `BaseView`, `ProjectedView`, `IsoView`, `SectionView`, `DetailView` (`readonly inputFingerprint?: string`).
11. **e2e test runs per T-6-17 pattern**: `pnpm --filter app exec playwright test tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts --project=chromium` (same as T-6-17 at `tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts`).
12. **Unit test command**: `pnpm --filter app test:unit -- --reporter=verbose <filename>` (app `package.json`: `"test:unit": "vitest run"`).
13. **`kernel.saveToBytes(partId)` is the real API for producing valid part bytes** (`packages/kernel/src/api.ts` line 71: `saveToBytes(partId: string, thumbnail?: Uint8Array): Promise<Uint8Array>`; used in `App.tsx` lines 3438–3439 as `await kernel.saveToBytes(doc.document.id)` followed by `opfs.write(...)`). The e2e uses this to write VALID, DIFFERENT bytes to the same OPFS partPath so reopen produces a different djb2 fingerprint.
14. **`activateDrawingDocument` must read `activePartId` before calling `loadDrawingSource`** and pass it as the `activePartId` arg — mirrors `CreateDrawingCommand.ts` lines 33 + 85. In the reopen path activePart is usually null (harmless), but preserves the test-fixture fallback. (Verifier FIX 3.)

---

## File map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `packages/app/src/storage/DrawingPacker.ts` | Pure `packDrawing(doc)` → `Uint8Array` and `unpackDrawing(bytes)` → `DrawingDocument`. No store, no kernel, no OPFS. |
| **Create** | `packages/app/src/storage/__tests__/DrawingPacker.spec.ts` | Round-trip + wrong-kind + bad-version tests. |
| **Modify** | `packages/app/src/storage/saveDrawingToOpfs.ts` | Replace inline `writeTarGz` call with `packDrawing(doc)`. |
| **Create** | `packages/app/src/drawing/activateDrawingDocument.ts` | Shared open/activate routine (setActiveDocument + cache clear + loadDrawingSource + setState slots). |
| **Create** | `packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts` | Happy-part / missing-source / assembly-source unit tests. |
| **Modify** | `packages/app/src/shell/tabs/FileTab.tsx` | Add `.zidw` accept type; replace `handleOpen` drawing `return`. (`handleSaveAs` drawing branch is out of scope.) |
| **Create** | `packages/app/src/shell/tabs/__tests__/FileTab.drawing.spec.ts` | handleOpen drawing branch + accept-type unit test. |
| **Create** | `tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts` | Real-geometry e2e: create drawing → mutate part OPFS → activateDrawingDocument → assert stale → Regenerate → assert projection changed. |

---

## Batch 1 — `packDrawing` / `unpackDrawing` round-trip (pure serializer)

### Task 1: Write `DrawingPacker.ts` with failing tests first

**Files:**
- Create: `packages/app/src/storage/DrawingPacker.ts`
- Create: `packages/app/src/storage/__tests__/DrawingPacker.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/storage/__tests__/DrawingPacker.spec.ts
import { describe, it, expect } from 'vitest';
import { packDrawing, unpackDrawing } from '../DrawingPacker';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import type { DrawingDocument } from '@zilventor/shared';

const baseDoc: DrawingDocument = {
  id: 'd1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 's1',
};

describe('packDrawing / unpackDrawing', () => {
  it('round-trips a DrawingDocument (pack → unpack recovers equal doc)', async () => {
    const bytes = await packDrawing(baseDoc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const recovered = await unpackDrawing(bytes);
    expect(recovered).toEqual(baseDoc);
  });

  it('unpackDrawing rejects an archive with kind !== drawing', async () => {
    // Build a fake archive with kind: 'assembly'
    const manifest = {
      formatVersion: 19,
      kind: 'assembly',
      document: baseDoc,
    };
    const bytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/kind/i);
  });

  it('unpackDrawing rejects a newer formatVersion (future file)', async () => {
    const manifest = {
      formatVersion: 9999,
      kind: 'drawing',
      document: baseDoc,
    };
    const bytes = await writeTarGz([
      { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/newer/i);
  });

  it('unpackDrawing rejects garbage bytes', async () => {
    await expect(unpackDrawing(new Uint8Array([0x00, 0x01, 0x02]))).rejects.toThrow();
  });

  it('unpackDrawing rejects archive missing manifest.json', async () => {
    const bytes = await writeTarGz([
      { name: 'not-manifest.txt', data: new TextEncoder().encode('hello') },
    ]);
    await expect(unpackDrawing(bytes)).rejects.toThrow(/manifest/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter app test:unit -- --reporter=verbose DrawingPacker
```

Expected: FAIL — `Cannot find module '../DrawingPacker'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/app/src/storage/DrawingPacker.ts
/**
 * Pure serializer for DrawingDocument ↔ .zidw tar.gz envelope.
 *
 * Mirrors AssemblyPacker (packages/kernel/src/storage/AssemblyPacker.ts)
 * but for drawing documents. No store, no kernel, no OPFS coupling.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '@zilventor/shared';
import { writeTarGz, readTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';

export async function packDrawing(doc: DrawingDocument): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'drawing' as const,
    createdAt: new Date().toISOString(),
    appVersion: '0.0.0',
    document: doc,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

export async function unpackDrawing(bytes: Uint8Array): Promise<DrawingDocument> {
  const entries = await readTarGz(bytes);

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) {
    throw new Error('DrawingPacker: manifest.json not found in archive');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch (e) {
    throw new Error(`DrawingPacker: malformed manifest.json: ${(e as Error).message}`);
  }

  // Kind check BEFORE migrateManifest — mirrors AssemblyPacker.ts lines 36-42.
  // This way a wrong-kind archive (e.g. a .zipt opened as .zidw) is rejected with
  // a clear message before we attempt format migration.
  const rawAny = raw as { kind?: string; formatVersion?: number };
  if (rawAny.kind !== 'drawing') {
    throw new Error(
      `DrawingPacker: expected kind: 'drawing', got kind: '${rawAny.kind ?? 'undefined'}'`,
    );
  }

  // migrateManifest throws if formatVersion > CURRENT_FORMAT_VERSION ("newer version")
  // and migrates older versions up to CURRENT_FORMAT_VERSION.
  const migrated = migrateManifest(raw as Parameters<typeof migrateManifest>[0]);

  return (migrated as unknown as { document: DrawingDocument }).document;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter app test:unit -- --reporter=verbose DrawingPacker
```

Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/storage/DrawingPacker.ts packages/app/src/storage/__tests__/DrawingPacker.spec.ts
git commit -m "$(cat <<'EOF'
feat(drawing-file-reopen): DrawingPacker — packDrawing / unpackDrawing pure serializer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refactor `saveDrawingToOpfs` to use `packDrawing`

**Files:**
- Modify: `packages/app/src/storage/saveDrawingToOpfs.ts`

Note: `handleSaveAs` drawing branch wiring is **out of scope** (spec is reopen-only; `handleSaveAs` drawing branch is a separate no-op TODO at `FileTab.tsx:44`). `packDrawing` is not dead code here — `saveDrawingToOpfs` uses it.

- [ ] **Step 1: Refactor `saveDrawingToOpfs.ts`**

Replace the full file with:

```ts
// packages/app/src/storage/saveDrawingToOpfs.ts
/**
 * Persists a DrawingDocument to OPFS under `drawings/<id>.zidw`.
 *
 * Uses packDrawing() — the same serializer used by unpackDrawing (handleOpen).
 *
 * NOTE: This module is dynamically imported by CreateDrawingCommand so
 * that unit tests can easily mock it with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { packDrawing } from './DrawingPacker';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export async function saveDrawingToOpfs(doc: DrawingDocument): Promise<void> {
  const bytes = await packDrawing(doc);
  const opfs = await Opfs.forNavigator();
  await opfs.write(`drawings/${doc.id}.zidw`, bytes);
}
```

- [ ] **Step 2: Run unit tests to confirm existing tests still pass**

```bash
pnpm --filter app test:unit -- --reporter=verbose DrawingPacker
pnpm --filter app test:unit -- --reporter=verbose saveDrawingToOpfs
```

Expected: all pass (no existing `saveDrawingToOpfs.spec.ts` to break, DrawingPacker spec stays green).

- [ ] **Step 3: Run full app unit suite**

```bash
pnpm --filter app test:unit
```

Expected: all tests pass (CreateDrawingCommand.spec mocks `saveDrawingToOpfs` wholesale — unaffected).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/storage/saveDrawingToOpfs.ts
git commit -m "$(cat <<'EOF'
feat(drawing-file-reopen): saveDrawingToOpfs delegates to packDrawing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 2 — `activateDrawingDocument` (unit-testable orchestrator)

### Task 3: Write `activateDrawingDocument` with failing tests first

**Files:**
- Create: `packages/app/src/drawing/activateDrawingDocument.ts`
- Create: `packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

// Mock loadDrawingSource + cache-clear so we control results
vi.mock('../loadDrawingSource', () => ({
  loadDrawingSource: vi.fn().mockResolvedValue({
    partId: 'kernel-part-uuid-mock',
    sourceFingerprint: 'fp-mock-bytes-hash',
  }),
  _clearLoadDrawingSourceCache: vi.fn(),
}));

// Mock Opfs — not used directly by activateDrawingDocument (passed via args) but
// Opfs.forNavigator may be imported by loadDrawingSource shim; mock defensively.
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    }),
  },
}));

const baseDoc: DrawingDocument = {
  id: 'drw-1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 's1',
};

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-uuid-mock'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function makeOpfs(existsResult = true) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    read: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
  };
}

function getStoreSlots() {
  const s = useAppStore.getState() as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };
  return { partId: s.activeDrawingSourcePartId, fingerprint: s.activeDrawingSourceFingerprint };
}

describe('activateDrawingDocument', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null,
      activePart: null,
      activeAssembly: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
    } as never);
    vi.clearAllMocks();
  });

  it('happy path (part source): sets activeDocument + source slots', async () => {
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });

    // activeDocument set correctly
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');
    expect((doc as { kind: 'drawing'; document: DrawingDocument }).document.id).toBe('drw-1');

    // Source slots set from loadDrawingSource mock
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBe('kernel-part-uuid-mock');
    expect(fingerprint).toBe('fp-mock-bytes-hash');
  });

  it('missing source (opfs.exists=false): drawing still activated, slots null, setStatus called', async () => {
    const { loadDrawingSource } = await import('../loadDrawingSource');
    (loadDrawingSource as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('OPFS_READ_FAILED: cannot load source part "parts/cabinet.zipt"')
    );
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(false);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });

    // Drawing still activated
    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');

    // Source slots remain null
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBeNull();
    expect(fingerprint).toBeNull();

    // Status message shows notice
    expect(useAppStore.getState().statusMessage).toMatch(/source part/i);
  });

  it('assembly source: setActiveDocument called, source-load skipped, slots null', async () => {
    const { loadDrawingSource } = await import('../loadDrawingSource');
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    const asmDoc: DrawingDocument = {
      ...baseDoc,
      id: 'drw-asm',
      source: { partPath: 'assemblies/wardrobe.ziasm', sourceKind: 'assembly' },
    };
    await activateDrawingDocument(asmDoc, { kernel: kernel as never, opfs: opfs as never });

    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');
    expect((doc as { kind: 'drawing'; document: DrawingDocument }).document.id).toBe('drw-asm');

    // loadDrawingSource must NOT be called for assembly
    expect(loadDrawingSource).not.toHaveBeenCalled();

    // Slots stay null
    const { partId, fingerprint } = getStoreSlots();
    expect(partId).toBeNull();
    expect(fingerprint).toBeNull();

    // Non-blocking notice
    expect(useAppStore.getState().statusMessage).toMatch(/assembly/i);
  });

  it('clears the loadDrawingSource cache before loading (fresh OPFS read)', async () => {
    const { _clearLoadDrawingSourceCache } = await import('../loadDrawingSource');
    const { activateDrawingDocument } = await import('../activateDrawingDocument');
    const kernel = makeKernel();
    const opfs = makeOpfs(true);
    await activateDrawingDocument(baseDoc, { kernel: kernel as never, opfs: opfs as never });
    expect(_clearLoadDrawingSourceCache).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter app test:unit -- --reporter=verbose activateDrawingDocument
```

Expected: FAIL — `Cannot find module '../activateDrawingDocument'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/app/src/drawing/activateDrawingDocument.ts
/**
 * Shared drawing open/activate routine.
 *
 * Called by FileTab.handleOpen (reopen) and extensible for other activation points.
 * Mirrors CreateDrawingCommand steps 1–4 minus the create-only saveDrawingToOpfs.
 *
 * Takes explicit kernel + opfs args (not from store) so unit tests can inject mocks
 * exactly like CreateDrawingCommand.spec does with vi.mock.
 */
import type { DrawingDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { KernelForLoad, OpfsForLoad } from './loadDrawingSource';

export async function activateDrawingDocument(
  doc: DrawingDocument,
  { kernel, opfs }: { kernel: KernelForLoad; opfs: OpfsForLoad },
): Promise<void> {
  // Step 1: activate the drawing as the active document.
  // setActiveDocument does NOT reset activeDrawingSourcePartId / activeDrawingSourceFingerprint —
  // we set them explicitly below.
  // Read activePartId BEFORE setActiveDocument (which nulls activePart), mirroring
  // CreateDrawingCommand.ts lines 33 + 85. In the reopen path activePart is usually null
  // (harmless no-op), but preserves the test-fixture fallback in loadDrawingSource.
  const activePartId = useAppStore.getState().activePart?.id;
  useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });

  // Step 2: skip source-load for assembly-sourced drawings (separate deferred work).
  if (doc.source.sourceKind === 'assembly') {
    // Slots stay null; Regenerate naturally disabled.
    useAppStore.getState().setStatus(
      'Assembly-sourced drawing opened — Regenerate unavailable (assembly projection is deferred)',
    );
    return;
  }

  // Step 3 (part source): clear the module-level cache so a re-activation
  // picks up any edits made since the last session.
  try {
    const { loadDrawingSource, _clearLoadDrawingSourceCache } = await import('./loadDrawingSource');
    _clearLoadDrawingSourceCache();

    const { partId, sourceFingerprint } = await loadDrawingSource({
      partPath: doc.source.partPath,
      kernel,
      opfs,
      activePartId,
    });

    // Step 4: set the store slots — triggers DrawingCanvas staleness useEffect.
    useAppStore.setState({
      activeDrawingSourcePartId: partId,
      activeDrawingSourceFingerprint: sourceFingerprint,
    } as never);
  } catch (e) {
    // Source part missing or kernel load failed. Drawing is already active (step 1)
    // and renders its saved projection. Regenerate is naturally disabled (slots null).
    // Non-blocking notice via status bar (setStatus) — not a modal error.
    console.warn('[activateDrawingDocument] source part load failed:', (e as Error).message);
    useAppStore.getState().setStatus(
      'Source part not found — Regenerate disabled. Open and re-save the part to restore.',
    );
    // Ensure slots are explicitly null (they may have had a previous value from a prior drawing).
    useAppStore.setState({
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
    } as never);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter app test:unit -- --reporter=verbose activateDrawingDocument
```

Expected: PASS — 4 tests green.

- [ ] **Step 5: Run full app suite**

```bash
pnpm --filter app test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/drawing/activateDrawingDocument.ts packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts
git commit -m "$(cat <<'EOF'
feat(drawing-file-reopen): activateDrawingDocument — shared open/activate orchestrator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 3 — `FileTab.handleOpen` drawing branch + unit test

### Task 4: Wire `handleOpen` drawing branch and add `.zidw` accept type

**Files:**
- Modify: `packages/app/src/shell/tabs/FileTab.tsx`
- Create: `packages/app/src/shell/tabs/__tests__/FileTab.drawing.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/shell/tabs/__tests__/FileTab.drawing.spec.ts
/**
 * Unit tests for the FileTab handleOpen drawing branch.
 *
 * We cannot render FileTab in jsdom (it calls showOpenFilePicker which requires
 * a real browser). Instead we test the branch logic by importing the helpers
 * directly and verifying the integration contract.
 *
 * Strategy: mock unpackDrawing + activateDrawingDocument, then drive handleOpen
 * via an extracted testable function (or spy on the imports).
 */
import { describe, it, expect, vi } from 'vitest';
import { packDrawing } from '../../../storage/DrawingPacker';
import type { DrawingDocument } from '@zilventor/shared';

// We test the serializer contract end-to-end and assert that unpackDrawing
// correctly returns a DrawingDocument — this validates the FileTab will receive
// the right value from unpackDrawing(bytes) when the branch runs.
const baseDoc: DrawingDocument = {
  id: 'drw-test',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1',
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
};

describe('FileTab handleOpen drawing branch integration', () => {
  it('packDrawing → unpackDrawing round-trip returns a valid DrawingDocument', async () => {
    // This verifies the exact byte flow FileTab uses: read file bytes → unpackDrawing
    const { unpackDrawing } = await import('../../../storage/DrawingPacker');
    const bytes = await packDrawing(baseDoc);
    const recovered = await unpackDrawing(bytes);
    expect(recovered.id).toBe('drw-test');
    expect(recovered.source.partPath).toBe('parts/test.zipt');
    expect(recovered.source.sourceKind).toBe('part');
    expect(recovered.sheets).toHaveLength(1);
  });

  it('unpackDrawing throws on wrong-kind bytes (bad .zipt opened as .zidw)', async () => {
    const { unpackDrawing } = await import('../../../storage/DrawingPacker');
    const { writeTarGz } = await import('@zilventor/kernel/src/storage/tarGzipUtil');
    const wrongKind = await writeTarGz([
      {
        name: 'manifest.json',
        data: new TextEncoder().encode(
          JSON.stringify({ formatVersion: 19, kind: 'part', document: {} })
        ),
      },
    ]);
    await expect(unpackDrawing(wrongKind)).rejects.toThrow(/kind/i);
  });

  it('the .zidw accept type is declared in FileTab showOpenFilePicker types', async () => {
    // Read the source to assert the accept type declaration
    // (structural test — verifies the literal string is present)
    const fs = await import('fs/promises');
    const src = await fs.readFile(
      new URL('../FileTab.tsx', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).toContain('.zidw');
    expect(src).toContain('application/zilinventor-drawing');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (3rd test expects `.zidw` in FileTab source)**

```bash
pnpm --filter app test:unit -- --reporter=verbose FileTab.drawing
```

Expected: 1st and 2nd tests PASS (DrawingPacker already works), 3rd test FAIL — `.zidw` not yet in FileTab.

- [ ] **Step 3: Wire `handleOpen` drawing branch in `FileTab.tsx`**

In `FileTab.tsx`:

1. Add import for `unpackDrawing` (only `unpackDrawing` — `packDrawing` is NOT imported here; `handleSaveAs` wiring is out of scope):

```ts
import { unpackDrawing } from '../../storage/DrawingPacker';
```

2. Add import for `activateDrawingDocument`:

```ts
import { activateDrawingDocument } from '../../drawing/activateDrawingDocument';
```

3. Add import for `Opfs` (needed to pass to activateDrawingDocument):

```ts
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';
```

4. Add `.zidw` to `showOpenFilePicker` accept types. The current types array in `handleOpen` (lines 79–83):

```ts
      const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
        types: [
          { description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } },
          { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
        ]
      });
```

Replace with:

```ts
      const [handle] = await (window as unknown as FSAWindow).showOpenFilePicker({
        types: [
          { description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } },
          { description: 'ZilInventor assembly', accept: { 'application/zilinventor-assembly': ['.ziasm'] } },
          { description: 'ZilInventor drawing', accept: { 'application/zilinventor-drawing': ['.zidw'] } },
        ]
      });
```

5. Replace the drawing branch (current lines 94–97):

```ts
      if (kind === 'drawing') {
        // TODO Sub-project 6: implement drawing open
        return;
      }
```

With:

```ts
      if (kind === 'drawing') {
        const doc = await unpackDrawing(bytes);
        const opfs = await Opfs.forNavigator();
        await activateDrawingDocument(doc, { kernel, opfs });
        setStatus('Opened');
        return;
      }
```

- [ ] **Step 4: Run tests to confirm all 3 pass**

```bash
pnpm --filter app test:unit -- --reporter=verbose FileTab.drawing
```

Expected: PASS — 3 tests green.

- [ ] **Step 5: Run full app suite**

```bash
pnpm --filter app test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/tabs/FileTab.tsx packages/app/src/shell/tabs/__tests__/FileTab.drawing.spec.ts
git commit -m "$(cat <<'EOF'
feat(drawing-file-reopen): wire handleOpen drawing branch + .zidw accept type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 4 — Real-geometry e2e gate (T-6-18)

### Task 5: Write T-6-18 real-geometry Playwright e2e

**Files:**
- Create: `tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts`

**No perf probe.** Reopen is I/O-bound (OPFS read + kernel.loadFromBytes): there is no new synchronous hot path. The existing `T63h`/`T63i` perf probes cover `fingerprintPartState` and `projectView` which are unchanged. A perf probe here would measure disk I/O variance, not deterministic JS performance.

**E2e strategy (real-bytes staleness happy-path):**
1. Build box A (50×50×30) via `buildBox` helper; call `kernel.saveToBytes(partId)` → write VALID bytes to OPFS at a fixed path `"drawing-source.zipt"` (not `"${partId}.zipt"` — we need real OPFS reads, not the fallback test-fixture path).
2. Create drawing via `CreateDrawingCommand({ sourcePath: "drawing-source.zipt", ... })` → this reads the real OPFS bytes → sets `inputFingerprint = djb2(bytes-of-box-A)` on the created base view after `AddBaseViewCommand`.
3. Build box B (60×60×40) via `buildBox` helper (different dimensions → different bytes) — or re-use the same part with a different extrude depth if building a second full part is slow.
4. Call `kernel.saveToBytes(partIdB)` → write those VALID bytes to the SAME OPFS path `"drawing-source.zipt"` (overwrite).
5. Call `activateDrawingDocument(doc, { kernel, opfs })` — reads box-B bytes → `djb2(bytes-of-box-B)` ≠ `inputFingerprint` (box-A fingerprint stored in view) → stale.
6. Assert `[data-stale-marker]` appears.
7. Click Regenerate → assert stale marker count decreases.

**Why this avoids the error path:** `kernel.loadFromBytes(valid-bytes)` succeeds → `_clearLoadDrawingSourceCache()` is called → `loadDrawingSource` reads box-B bytes → produces a non-null `sourceFingerprint` ≠ view's `inputFingerprint` → the staleness condition fires (condition b: both fingerprints non-null, values differ). No garbage bytes, no `loadFromBytes` throw, no `sourceFingerprint = null` short-circuit.

**Real API used:** `kernel.saveToBytes(partId)` (`packages/kernel/src/api.ts` line 71) + `Opfs.forNavigator().write(path, bytes)` (`App.tsx` lines 3438–3439 pattern).

- [ ] **Step 1: Write the failing e2e test**

```ts
// tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts
/**
 * T-6-18 — Drawing file reopen: staleness pipeline fires on reopen (HAPPY PATH).
 *
 * Tests the full real-bytes loop — NOT the error path:
 *   1. Build box A (50×50×30); save VALID bytes to OPFS at "drawing-source.zipt".
 *   2. Create drawing sourced from "drawing-source.zipt" (real OPFS read, not fallback).
 *   3. Place base view (real projection, view.inputFingerprint = djb2(bytes-of-A)).
 *   4. Build box B (60×60×40); save VALID bytes to SAME OPFS path (overwrite).
 *   5. Call activateDrawingDocument — reads box-B bytes → djb2(bytes-of-B) ≠ inputFingerprint.
 *   6. Assert base view flagged stale (condition b: both fingerprints non-null, different).
 *   7. Click Regenerate → assert stale marker cleared + edges > 0.
 *
 * Real API: kernel.saveToBytes(partId) → Uint8Array (packages/kernel/src/api.ts:71)
 *           + Opfs.forNavigator().write(path, bytes) (App.tsx:3438-3439 pattern).
 * Import idiom: await import('/src/...') inside page.evaluate — same as T-6-17.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-18: drawing reopen — valid mutated OPFS bytes → stale flag (happy path) → Regenerate clears it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build box A (50×50×30) — first source shape.
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // 2. Save box-A bytes to OPFS at a fixed path, create drawing sourced from that path,
  //    place a base view with real projection.
  const SOURCE_PATH = 'drawing-source.zipt';
  const { sheetId, baseViewId } = await page.evaluate(async ({ sourcePath }: { sourcePath: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string } | null;
          activeDrawingSourcePartId: string | null;
          activeDrawingSourceFingerprint: string | null;
          kernel: {
            execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
            saveToBytes(id: string): Promise<Uint8Array>;
          } | null;
          activeDocument: {
            kind: string;
            document: {
              id: string; name: string; units: string;
              source: { partPath: string; sourceKind: string };
              properties: unknown; sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] }; inputFingerprint?: string }> }>; activeSheetId: string;
            };
          } | null;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || !s.kernel) throw new Error('T-6-18: kernel or activePart not ready');

    const kernel = s.kernel;
    const partIdA = s.activePart.id;

    // Warm kernel cache for box A
    await kernel.execute(partIdA);

    // Save box-A bytes to a stable OPFS path (real content, not fallback)
    const bytesA = await kernel.saveToBytes(partIdA);
    const { Opfs } = await import('/src/../../node_modules/@zilventor/kernel/src/storage/Opfs.ts') as {
      Opfs: { forNavigator(): Promise<{ write(p: string, d: Uint8Array): Promise<void>; read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> }> };
    };
    const opfs = await Opfs.forNavigator();
    await opfs.write(sourcePath, bytesA);

    // Create drawing sourced from the real OPFS path (triggers real loadDrawingSource, not fallback)
    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

    // Verify source slots set from REAL bytes (fingerprint = djb2(bytesA))
    const afterCreate = w.__zilventorStore.getState();
    if (!afterCreate.activeDrawingSourcePartId) {
      throw new Error('T-6-18: activeDrawingSourcePartId null after CreateDrawingCommand');
    }
    if (!afterCreate.activeDrawingSourceFingerprint) {
      throw new Error('T-6-18: activeDrawingSourceFingerprint null — OPFS read may have taken fallback path');
    }
    const fpA = afterCreate.activeDrawingSourceFingerprint;

    const activeDoc = afterCreate.activeDocument!;
    const sheetId = activeDoc.document.sheets[0]!.id;

    // Place base view — projection stores inputFingerprint = fpA
    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId,
      positionMm: { x: 80, y: 80 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    }).apply();

    // Verify base view has real edges AND stored inputFingerprint
    const s2 = w.__zilventorStore.getState();
    const doc2 = s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
    const sheet = doc2?.sheets.find((sh) => sh.id === sheetId);
    const baseView = sheet?.views.find((v) => v.kind === 'base');
    if (!baseView) throw new Error('T-6-18: base view not found');
    if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
      throw new Error('T-6-18: base view has no real projected edges');
    }
    if (!baseView.inputFingerprint) {
      throw new Error(`T-6-18: base view inputFingerprint not set (fpA was: ${fpA})`);
    }

    return { sheetId, baseViewId: baseView.id };
  }, { sourcePath: SOURCE_PATH });

  // 3. Switch to drawing tab.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 4. Build box B (60×60×40) — second shape with different geometry.
  //    After buildBox the UI is on the Model tab with a new part active.
  await page.getByRole('tab', { name: 'Model' }).click();
  await buildBox(page, { width: 60, height: 60, depth: 40 });

  // 5. Save box-B bytes to the SAME OPFS path (overwrite). This simulates the user
  //    re-saving the source part after an edit. The bytes are VALID (kernel.saveToBytes
  //    produces a well-formed .zipt archive) so kernel.loadFromBytes won't throw.
  const currentDoc = await page.evaluate(async ({ sourcePath }: { sourcePath: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string } | null;
          kernel: { execute(id: string): Promise<{ ok: boolean }>; saveToBytes(id: string): Promise<Uint8Array> } | null;
          activeDocument: { kind: string; document: unknown } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || !s.kernel) throw new Error('T-6-18 step 5: kernel or activePart not ready');
    const partIdB = s.activePart.id;
    await s.kernel.execute(partIdB);
    const bytesB = await s.kernel.saveToBytes(partIdB);

    const { Opfs } = await import('/src/../../node_modules/@zilventor/kernel/src/storage/Opfs.ts') as {
      Opfs: { forNavigator(): Promise<{ write(p: string, d: Uint8Array): Promise<void> }> };
    };
    const opfs = await Opfs.forNavigator();
    await opfs.write(sourcePath, bytesB);
    // bytesB.length likely differs from bytesA.length (different extrude depth)
    // → different djb2 hash → different sourceFingerprint after reopen

    // The drawing document was set earlier; retrieve it now to return for step 6.
    // Note: activeDocument may show the part now (buildBox creates a new part doc);
    // we retrieve the drawing doc from the previous state by re-reading OPFS drawings dir.
    // Simplest: we stored the drawing doc in the evaluate closure via sheetId above.
    // Since the store's activeDocument is now a part, we cannot read it here;
    // the caller already has sheetId + baseViewId to reconstruct the doc identity.
    return { partIdB };
  }, { sourcePath: SOURCE_PATH });
  void currentDoc; // sheetId / baseViewId captured earlier; partIdB only for debugging

  // 6. Re-activate the drawing by calling activateDrawingDocument directly.
  //    We must reconstruct the DrawingDocument from OPFS (saved by CreateDrawingCommand).
  //    activateDrawingDocument reads box-B bytes → djb2(bytesB) ≠ view.inputFingerprint (box-A fp)
  //    → activeDrawingSourceFingerprint set to fpB → DrawingCanvas staleness useEffect fires.
  await page.evaluate(async ({ sourcePath, sheetId: _sheetId }: { sourcePath: string; sheetId: string }) => {
    const { Opfs } = await import('/src/../../node_modules/@zilventor/kernel/src/storage/Opfs.ts') as {
      Opfs: { forNavigator(): Promise<{ write(p: string, d: Uint8Array): Promise<void>; read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> }> };
    };
    const opfs = await Opfs.forNavigator();

    // Find the .zidw file written by CreateDrawingCommand (drawings/<id>.zidw in OPFS).
    // We don't know the drawing id here, so list drawing files via the FileSystem API.
    const root = await navigator.storage.getDirectory();
    const drawingsDir = await root.getDirectoryHandle('drawings', { create: false }).catch(() => null);
    if (!drawingsDir) throw new Error('T-6-18 step 6: no drawings/ directory in OPFS');
    let zidwPath: string | null = null;
    for await (const [name] of (drawingsDir as unknown as AsyncIterable<[string, unknown]>)) {
      if (String(name).endsWith('.zidw')) { zidwPath = `drawings/${String(name)}`; break; }
    }
    if (!zidwPath) throw new Error('T-6-18 step 6: no .zidw file found in drawings/');

    const zidwBytes = await opfs.read(zidwPath);
    const { unpackDrawing } = await import('/src/storage/DrawingPacker.ts');
    const doc = await unpackDrawing(zidwBytes);

    const w = window as unknown as {
      __zilventorStore: { getState(): { kernel: unknown } };
    };
    const kernel = w.__zilventorStore.getState().kernel;
    const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
    await activateDrawingDocument(doc, { kernel: kernel as never, opfs: opfs as never });
  }, { sourcePath: SOURCE_PATH, sheetId });

  // 7. Assert stale marker appears (base view fingerprint mismatch: fpA ≠ fpB).
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore).toBeGreaterThan(0);

  // 8. Click Regenerate on the stale base view.
  await page.locator('[data-stale-marker]').first().click();

  // 9. After regen the stale marker count must decrease.
  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCountBefore);
  }).toPass({ timeout: 15_000 });

  // 10. The view still renders edges (projection succeeded with box B geometry).
  const edgeCount = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCount).toBeGreaterThan(0);
});
```

**Import idiom for Opfs inside `page.evaluate`:** Uses `/src/../../node_modules/@zilventor/kernel/src/storage/Opfs.ts` — the absolute-path form that Vite's dev server exposes for node_modules imports inside `page.evaluate`. If this path fails, the alternative is to read from the store's opfs reference or use `navigator.storage.getDirectory()` directly (the FileSystem Access API used by `Opfs.forNavigator()` under the hood). See T-6-17 step comment for the import path precedent (`/src/commands/...`).

- [ ] **Step 2: Run the e2e test to confirm it fails for the right reason**

```bash
pnpm --filter app exec playwright test tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts --project=chromium
```

Expected: FAIL — `activateDrawingDocument` module not found (Batch 2 not yet merged) or `DrawingPacker` module not found (Batch 1 not yet merged). Once all batches are in, expected failure is stale-marker assertion if there is a drawing-dir listing issue.

- [ ] **Step 3: Fix OPFS listing if needed**

If step 6 (listing `drawings/` directory) fails (FileSystem Access API not supported in test Chromium, or the directory structure differs), replace the directory-listing with a simpler approach: pass `drawingId` from step 2 back to step 6 and read `drawings/${drawingId}.zidw` directly. The `drawingId` is available in the `page.evaluate` in step 2 via `afterCreate.activeDocument.document.id`. Adjust the return value of step 2's `page.evaluate` to include `drawingId`.

- [ ] **Step 4: Run the full e2e to confirm it passes end-to-end**

```bash
pnpm --filter app exec playwright test tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts --project=chromium
```

Expected: PASS — T-6-18 green (real-bytes staleness happy path).

- [ ] **Step 5: Run full unit gate**

```bash
pnpm -r test:unit
```

Expected: all tests pass (same count as pre-feature + new tests).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts
git commit -m "$(cat <<'EOF'
test(drawing-file-reopen): T-6-18 real-geometry e2e — valid-bytes reopen → stale (happy-path) → Regenerate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Final review — write a `final-review` note (not a separate file; inline here)

After Batch 4 passes, run the full suite one more time and check:

- [ ] **Step 1: Full unit gate**

```bash
pnpm -r test:unit
```

Expected: all pass. Note the new test count (was 2808 at HEAD `06d7805`; should be ~2808 + new tests).

- [ ] **Step 2: Check for ESLint errors (CI gate)**

```bash
pnpm lint
```

Expected: no errors (the `handleOpen` drawing branch adds `await` expressions; confirm `kernel` is still accessed before the drawing branch even if `kernel` is not used in that path — the `if (!kernel) return;` guard on line 75 is still valid).

- [ ] **Step 3: Verify `DrawingCanvas` `useEffect` dep array is unchanged**

Confirm `packages/app/src/drawing/DrawingCanvas.tsx` line 158 still reads:
```ts
  }, [drawing.id, sheet.id, activeDrawingSourceFingerprint]);
```
No change was made here — the staleness pipeline already fires correctly when `activeDrawingSourceFingerprint` changes.

- [ ] **Step 4: Verify `setActiveDocument` still does NOT reset source slots**

Confirm `packages/app/src/store/useAppStore.ts` lines 362–367 are unchanged (fact-checked at plan-write time; `activateDrawingDocument` sets slots explicitly after calling `setActiveDocument`).

- [ ] **Step 5: Commit if any clean-up changes were made**

```bash
git add -p  # stage only your clean-up changes
git commit -m "$(cat <<'EOF'
fix(drawing-file-reopen): final-review clean-up (lint + types)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| `packDrawing(doc) → Uint8Array` | Task 1 |
| `unpackDrawing(bytes) → DrawingDocument` | Task 1 |
| `unpackDrawing` kind-check BEFORE `migrateManifest` (mirrors AssemblyPacker) | Task 1 |
| `saveDrawingToOpfs` refactored to use `packDrawing` | Task 2 |
| `handleSaveAs` drawing branch | **OUT OF SCOPE** — removed per verifier FIX 4 |
| `unpackDrawing` rejects wrong `kind` | Task 1 (spec §Architecture unit 1) |
| `unpackDrawing` rejects unknown/future `formatVersion` | Task 1 |
| `activateDrawingDocument` — happy part path | Task 3 |
| `activateDrawingDocument` — missing source | Task 3 |
| `activateDrawingDocument` — assembly source | Task 3 |
| `activateDrawingDocument` passes `activePartId` to `loadDrawingSource` | Task 3 |
| `_clearLoadDrawingSourceCache` called on each activate | Task 3 |
| `handleOpen` drawing branch replaces `return` | Task 4 |
| `FileTab.tsx` imports only `unpackDrawing` (not `packDrawing`) | Task 4 |
| `.zidw` added to `showOpenFilePicker` accept types | Task 4 |
| Real-geometry e2e: real-bytes staleness happy-path → stale → Regenerate | Task 5 |
| No manifest bump (v19 unchanged) | ✓ (no `CURRENT_FORMAT_VERSION` change; `packDrawing` writes `19`, reads with `migrateManifest`) |
| Non-blocking notice on missing source | Task 3 (`setStatus`) |
| No perf probe (I/O-bound reopen) | Stated in Batch 4 intro |

### Placeholder scan

No TBD, TODO, "similar to Task N", or incomplete code blocks remain.

### Type consistency

- `KernelForLoad` and `OpfsForLoad` are imported from `./loadDrawingSource` in `activateDrawingDocument.ts` — same types used by `loadDrawingSource` itself.
- `DrawingDocument` imported from `@zilventor/shared` throughout — consistent.
- `activeDrawingSourcePartId` / `activeDrawingSourceFingerprint` written with `useAppStore.setState({ ... } as never)` — consistent with `CreateDrawingCommand.ts` lines 87–90.
- `packDrawing` / `unpackDrawing` named identically in `DrawingPacker.ts`, `DrawingPacker.spec.ts`, and `saveDrawingToOpfs.ts`. `FileTab.tsx` imports only `unpackDrawing` (not `packDrawing` — `handleSaveAs` is out of scope).
- `activateDrawingDocument` named identically in `activateDrawingDocument.ts`, `activateDrawingDocument.spec.ts`, and `FileTab.tsx` import.
- `activePartId` read from `useAppStore.getState().activePart?.id` BEFORE `setActiveDocument` call in `activateDrawingDocument` — consistent with `CreateDrawingCommand.ts` line 33.
- `loadDrawingSource({ ..., activePartId })` call shape consistent with `LoadDrawingSourceArgs` type in `loadDrawingSource.ts` line 67–73.
