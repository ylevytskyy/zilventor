# Plan: Drawing View Projection Pipeline

<!-- REQUIRED SUB-SKILL: superpowers:test-driven-development -->

**Date:** 2026-05-25
**Feature:** F3.9 / Phase-8-completion — Wire live-UI drawing view projection pipeline
**Spec:** `docs/superpowers/specs/2026-05-25-drawing-view-projection-pipeline-design.md`
**Status:** Ready for implementation

---

## Goal

Wire the full projection pipeline so:
1. Placing a base, projected, or iso view calls the kernel `getProjectorInput` RPC and runs `projectView`, storing real geometry on the view.
2. Clicking Regenerate re-projects the current view geometry (not just clears the stale marker).
3. Editing the source part and returning to the drawing flags affected views as stale via a cheap synchronous fingerprint compared on activation.

Success = `T-6-17` Playwright e2e asserts real projected edges (not hand-typed) for a base view created via the live UI.

---

## Architecture

### Source-geometry loading on drawing activation (NEW — B0)

`drawingDocState()` deliberately sets `activePart: null` (confirmed at
`packages/app/src/store/drawingDocState.ts:12`). In the real app there is
therefore no loaded source part and its geometry is not guaranteed to be in
the kernel's `namedShapeCache`. `getProjectorInput` **throws** (`partId "..."
not in cache`) when the part isn't cached.

Fix: add a new store slot `activeDrawingSourcePartId: string | null` (default
`null`). When a drawing is created from a part (via `CreateDrawingCommand`),
immediately after writing the drawing to the store, load the source part bytes
from OPFS and execute them into the kernel — identical to the assembly leaf
pattern at `App.tsx:3187-3189`:
```
bytes  = await opfs.read(partPath)
partId = await kernel.loadFromBytes(bytes)
await kernel.execute(partId)
```
Then set `activeDrawingSourcePartId = partId`. Cache by `partPath` so
reactivating the same drawing does not reload.

**`source.partPath` semantics (resolved):** `CreateDrawingCommand` receives
`sourcePath` from `NewDrawingDialog`, which comes from the OPFS file-picker
`handle.name` (e.g. `"cabinet1.zipt"`) or the store slot
`newDrawingSourcePath`. That name is stored verbatim as
`drawing.source.partPath`. In the real create-from-part flow `partPath` is
therefore an **OPFS filename** (e.g. `"cabinet1.zipt"` or
`"parts/cabinet1.zipt"`) — readable via `opfs.read(partPath)`. Tests
(including existing e2e) inject synthetic values like `"${partId}.zipt"` which
are NOT real OPFS paths; the B0 loader must handle this gracefully (if
`opfs.read` throws, fall back to `state.activePart?.id` if the active part id
matches the partPath stem, i.e. `partPath === activePart.id + '.zipt'`). Drawing
file-reopen (`FileTab.tsx:95` — marked TODO Sub-project 6) is **out of scope**;
B0 only covers the create-from-part flow.

### Shared projection helper (NEW)
`packages/app/src/drawing/projectViewFromSource.ts` — single async function called by all three Add* commands and `handleRegenerate`. Reads `state.kernel`, `state.activeDrawingSourcePartId`, and `state.activeDrawingSourceFingerprint`. Returns `{ projection: ProjectedGeometry; inputFingerprint: string }`.

**Critical constraints:**
- `drawingDocState()` sets `activePart: null` (confirmed at `packages/app/src/store/drawingDocState.ts:12`). The helper reads `activeDrawingSourcePartId` (set by B0) as the kernel part id — NOT `activePart?.id`. Throws `'PART_NOT_IN_STORE'` if both are null.
- `inputFingerprint` is `activeDrawingSourceFingerprint` (bytes hash, set by `loadDrawingSource` in B0) — NOT `djb2(kernelId)`. Kernel UUIDs are session-stable; hashing one would never change on source edits and would gut staleness detection.
- `kernel.getProjectorInput` returns `Promise<ProjectorInput | null>` (null = part not cached; confirmed at `packages/kernel/src/api.ts:93`). The helper handles null → throws `'GEOMETRY_NOT_CACHED'`.

### New pure helper
`packages/shared/src/drawing/deriveProjectedOrientation.ts` — pure third-angle projection table (≤24 cases). Placed in `shared` to match where `viewMatrix.ts` and `projector.ts` live.

### New pure helper
`packages/app/src/drawing/fingerprintPartState.ts` — synchronous djb2 hash of `partDoc.featureTree` and `partDoc.parameters` JSON. Pure, no imports from kernel. Used ONLY as the fallback fingerprint when `activePart` is available directly in unit tests. In the live app the fingerprint comes from `activeDrawingSourceFingerprint` (set by `loadDrawingSource` from raw bytes).

### Command changes
- `AddBaseViewCommand.apply()` — already async; call helper, store `projection` + `inputFingerprint`.
- `AddProjectedViewCommand.apply()` — already async; derive orientation via `deriveProjectedOrientation(baseView.orientation, direction)`, call helper.
- `AddIsoViewCommand.apply()` — already async; map `corner → 'iso-<corner>'`, call helper.
- `RegenerateViewCommand` — constructor opts shape unchanged (`sheetId, viewId, projection, inputFingerprint`); no changes needed.

### UI wiring (DrawingCanvas)
- `handleClick` `placeBase` branch (currently a no-op comment at :838): dispatch `AddBaseViewCommand`.
- `handleClick` `placeProjected` branch: read `pendingViewParams` (kind `'projected'`, `baseViewId`, `direction` already set by dialog), dispatch `AddProjectedViewCommand`.
- `handleClick` `placeIso` branch: read `pendingViewParams` (kind `'iso'`, `corner`, `scale`), dispatch `AddIsoViewCommand`.
- `handleRegenerate` (currently only clears marker at :842): also call helper + `bus.execute(new RegenerateViewCommand(...))`.

### Staleness (B5)
On drawing activation, the `DrawingCanvas` useEffect reads `activeDrawingSourceFingerprint` directly from the store (already set by `loadDrawingSource` during B0.3 `CreateDrawingCommand.apply()`). It compares each view's `view.inputFingerprint` against `activeDrawingSourceFingerprint`. A mismatch means the source bytes changed since the view was projected → view is flagged stale. No additional OPFS read is needed at staleness-check time: the fingerprint was already captured from bytes at load time.

**Staleness conditions:**
- `(a)` view has `projection` but no `inputFingerprint` — legacy / hand-injected views.
- `(b)` view has `inputFingerprint` but it doesn't match `activeDrawingSourceFingerprint` — source was edited since the view was placed.

**dep array:** `[drawing.id, sheet.id, activeDrawingSourceFingerprint]` — re-runs whenever the fingerprint slot changes (i.e. whenever the drawing is re-activated from a fresh OPFS read).

### Two-renderer-path note
No new render branches needed. `projection` and `inputFingerprint` are already read by both the canvas SVG renderer and the PDF/SVG export path. Populating those fields makes the renderers work automatically.

---

## Tech Stack

- Vitest + `useAppStore.setState` for unit tests (mirror existing command specs).
- `pnpm --filter app test:unit` for the app package; `pnpm --filter @zilventor/shared test:unit` for shared.
- Playwright for B6 e2e.
- No new dependencies.

---

## Test run commands

```
# App package unit tests (single file):
pnpm --filter app test:unit -- --run src/commands/__tests__/<File>.spec.ts

# Shared package unit tests:
pnpm --filter @zilventor/shared test:unit -- --run src/drawing/__tests__/<File>.spec.ts

# Full app unit suite (run after every batch to catch regressions):
pnpm --filter app test:unit

# Full shared unit suite:
pnpm --filter @zilventor/shared test:unit

# E2E (B6):
pnpm --filter app exec playwright test tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts
```

---

## Batches

---

## Batch 0 — Source-geometry load on drawing activation

### Task 0.1 — `activeDrawingSourcePartId` + `activeDrawingSourceFingerprint` store slots

**Confirmed facts before writing:**
- `AppState` type is in `packages/app/src/store/useAppStore.ts` lines 89–322.
- Existing drawing slots at lines 94–95 (`activePart: PartDocument | null`, `activeDrawing: DrawingDocument | null`).
- Initializer block starts at line 324 (`export const useAppStore = create<AppState>(...)`); drawing slot initializers are at lines 330 and 711 area.
- Both new slots must be declared in the type block and initialized to `null` in the initializer.
- `drawingDocState()` must also reset both to `null` — it sets `activePart: null`, `activeAssembly: null`; add both new slots to keep the "drawing commands see no stale state" invariant.

**Why two slots:**
- `activeDrawingSourcePartId` — the kernel UUID returned by `loadFromBytes`, needed by `getProjectorInput`.
- `activeDrawingSourceFingerprint` — a djb2 hash of the raw OPFS bytes used to load the part, set at the same time as `activeDrawingSourcePartId`. This is the only content-based fingerprint available in the live drawing context (where `activePart` is null). It changes whenever the source `.zipt` file changes, making staleness detection reliable. A kernel UUID is stable across the session, so `djb2(kernelId)` would NEVER detect a source edit — hence the separate slot.

**Failing test name:** `activeDrawingSourcePartId + activeDrawingSourceFingerprint store slots — default to null and can be set`

**RED test** — create `packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts`:

```typescript
// packages/app/src/store/__tests__/activeDrawingSourcePartId.spec.ts
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('activeDrawingSourcePartId + activeDrawingSourceFingerprint store slots', () => {
  it('activeDrawingSourcePartId defaults to null', () => {
    const state = useAppStore.getState();
    expect('activeDrawingSourcePartId' in state).toBe(true);
    expect((state as unknown as { activeDrawingSourcePartId: unknown }).activeDrawingSourcePartId).toBeNull();
  });

  it('activeDrawingSourceFingerprint defaults to null', () => {
    const state = useAppStore.getState();
    expect('activeDrawingSourceFingerprint' in state).toBe(true);
    expect((state as unknown as { activeDrawingSourceFingerprint: unknown }).activeDrawingSourceFingerprint).toBeNull();
  });

  it('both slots can be set to strings', () => {
    useAppStore.setState({
      activeDrawingSourcePartId: 'kernel-part-uuid-123',
      activeDrawingSourceFingerprint: 'fp-abc123',
    } as never);
    const s = useAppStore.getState() as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    expect(s.activeDrawingSourcePartId).toBe('kernel-part-uuid-123');
    expect(s.activeDrawingSourceFingerprint).toBe('fp-abc123');
  });

  it('drawingDocState resets both slots to null', () => {
    const { drawingDocState } = require('../drawingDocState') as typeof import('../drawingDocState');
    useAppStore.setState({ activeDrawingSourcePartId: 'some-id', activeDrawingSourceFingerprint: 'some-fp' } as never);
    const fakeDoc = { id: 'd1', name: 'D', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets: [], activeSheetId: 's1' };
    const patch = drawingDocState(fakeDoc as never);
    expect((patch as unknown as { activeDrawingSourcePartId: unknown }).activeDrawingSourcePartId).toBeNull();
    expect((patch as unknown as { activeDrawingSourceFingerprint: unknown }).activeDrawingSourceFingerprint).toBeNull();
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/store/__tests__/activeDrawingSourcePartId.spec.ts`
Expected RED: last test fails (`patch` doesn't have either slot); first two tests may also fail if slots missing.

**GREEN impl — Step 1:** Add to `AppState` type in `packages/app/src/store/useAppStore.ts`, inside the type block after `activeDrawing: DrawingDocument | null;` (line 95):

```typescript
  /** Kernel part id loaded from the drawing's source.partPath on drawing activation.
   *  Null when no drawing is active or the source part has not yet loaded.
   *  Set by loadDrawingSource (called from CreateDrawingCommand.apply / future reopen path).
   *  Reset to null by drawingDocState() so drawing commands always see a clean slate. */
  activeDrawingSourcePartId: string | null;

  /** djb2 hash of the raw OPFS bytes used to load the source part (set alongside
   *  activeDrawingSourcePartId by loadDrawingSource). Used by projectViewFromSource as
   *  inputFingerprint and by the B5 staleness useEffect to detect source edits.
   *  A kernel UUID is stable per-session, so djb2(kernelId) would NEVER detect edits —
   *  hashing the actual bytes is the correct content-based change-detector.
   *  Null when no drawing is active or the source part has not yet loaded.
   *  Reset to null by drawingDocState(). */
  activeDrawingSourceFingerprint: string | null;
```

**GREEN impl — Step 2:** Add initializers in the `create<AppState>` block after `activeDrawing: null,` (line 330):

```typescript
  activeDrawingSourcePartId: null,
  activeDrawingSourceFingerprint: null,
```

**GREEN impl — Step 3:** Edit `packages/app/src/store/drawingDocState.ts` — add both new slots to the returned object so they are always reset when a drawing activates:

```typescript
// packages/app/src/store/drawingDocState.ts
import type { DrawingDocument } from '@zilventor/shared';

/**
 * Derived store slice for "a drawing document is now active".
 * Spread into useAppStore.setState(...) so activeDrawing can never drift from
 * activeDocument — see docs/superpowers/specs/2026-05-25-active-drawing-audit-design.md.
 *
 * Also resets activeDrawingSourcePartId and activeDrawingSourceFingerprint to null
 * so that stale kernel ids and fingerprints from a previous drawing session never
 * bleed into the new drawing context. loadDrawingSource sets both slots AFTER this
 * reset, asynchronously.
 */
export function drawingDocState(nextDoc: DrawingDocument) {
  return {
    activeDocument: { kind: 'drawing' as const, document: nextDoc },
    activePart: null,
    activeAssembly: null,
    activeDrawing: nextDoc,
    activeDrawingSourcePartId: null,
    activeDrawingSourceFingerprint: null,
  };
}
```

Run: `pnpm --filter app test:unit -- --run src/store/__tests__/activeDrawingSourcePartId.spec.ts`
Expected GREEN: 3 tests pass.

Run full suite: `pnpm --filter app test:unit`
Expected GREEN (the `drawingDocState` spec at `packages/app/src/store/__tests__/drawingDocState.spec.ts` may now fail because it doesn't expect the new field — update it to also assert `patch.activeDrawingSourcePartId === null`).

**Commit:** `feat(projection-pipeline): B0.1 — activeDrawingSourcePartId store slot + drawingDocState reset`

---

### Task 0.2 — `loadDrawingSource` helper (OPFS → kernel cache → returns `{ partId, sourceFingerprint }`)

**Failing test name:** `loadDrawingSource — returns { partId, sourceFingerprint } and caches by partPath`

**Key design:** `loadDrawingSource` returns BOTH the kernel partId AND a `sourceFingerprint` derived from the raw bytes it reads. The fingerprint is a djb2 hash over the bytes (treated as char codes mod 65536). This is the content-based fingerprint used by `projectViewFromSource` as `inputFingerprint` and by B5 staleness detection. Because bytes change on every part save, the fingerprint changes on every source edit — staleness detection is now reliable.

**Test fixture fallback path:** when OPFS read throws (synthetic `${partId}.zipt` paths used in tests), the fingerprint is `djb2(activePartId)`. This is acceptable ONLY for the test-fixture path — real OPFS reads must hash bytes. The split is documented in the implementation.

**NOTE on `execute` return type:** `kernel.execute(partId)` returns `Promise<Result<ExecuteResult, KernelError>>` (confirmed at `packages/kernel/src/api.ts:67`), i.e. `{ ok: true; value: ExecuteResult } | { ok: false; error: KernelError }`. The `KernelForLoad` type below uses the minimal required shape. The caller should check `res.ok` and propagate errors.

**RED test** — create `packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts`:

```typescript
// packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDrawingSource } from '../loadDrawingSource';

const FAKE_BYTES_A = new Uint8Array([1, 2, 3]);
const FAKE_BYTES_B = new Uint8Array([9, 8, 7, 6]); // different bytes → different fingerprint
const FAKE_PART_ID = 'kernel-part-uuid-abc';

function makeKernel(loadFromBytesResult = FAKE_PART_ID) {
  return {
    loadFromBytes: vi.fn().mockResolvedValue(loadFromBytesResult),
    execute: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  };
}

function makeOpfs(bytes = FAKE_BYTES_A) {
  return {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(bytes),
  };
}

describe('loadDrawingSource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads bytes, calls kernel.loadFromBytes + execute, returns { partId, sourceFingerprint }', async () => {
    const kernel = makeKernel();
    const opfs = makeOpfs();
    const result = await loadDrawingSource({ partPath: 'cabinet.zipt', kernel: kernel as never, opfs: opfs as never });
    expect(result.partId).toBe(FAKE_PART_ID);
    expect(typeof result.sourceFingerprint).toBe('string');
    expect(result.sourceFingerprint.length).toBeGreaterThan(0);
    expect(opfs.read).toHaveBeenCalledWith('cabinet.zipt');
    expect(kernel.loadFromBytes).toHaveBeenCalledWith(FAKE_BYTES_A);
    expect(kernel.execute).toHaveBeenCalledWith(FAKE_PART_ID);
  });

  it('different bytes → different sourceFingerprint (content-based change detection)', async () => {
    const kernelA = makeKernel('partA');
    const kernelB = makeKernel('partB');
    const opfsA = makeOpfs(FAKE_BYTES_A);
    const opfsB = makeOpfs(FAKE_BYTES_B);
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const rA = await fresh({ partPath: 'partA.zipt', kernel: kernelA as never, opfs: opfsA as never });
    const rB = await fresh({ partPath: 'partB.zipt', kernel: kernelB as never, opfs: opfsB as never });
    expect(rA.sourceFingerprint).not.toBe(rB.sourceFingerprint);
  });

  it('same bytes → same sourceFingerprint (deterministic)', async () => {
    const kernelA = makeKernel('p1');
    const kernelB = makeKernel('p1');
    const opfsA = makeOpfs(FAKE_BYTES_A);
    const opfsB = makeOpfs(FAKE_BYTES_A);
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const r1 = await fresh({ partPath: 'pa1.zipt', kernel: kernelA as never, opfs: opfsA as never });
    const r2 = await fresh({ partPath: 'pa2.zipt', kernel: kernelB as never, opfs: opfsB as never });
    expect(r1.sourceFingerprint).toBe(r2.sourceFingerprint);
  });

  it('caches the result — second call with same partPath skips OPFS + kernel', async () => {
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const kernel = makeKernel();
    const opfs = makeOpfs();
    const r1 = await fresh({ partPath: 'cabinet2.zipt', kernel: kernel as never, opfs: opfs as never });
    const r2 = await fresh({ partPath: 'cabinet2.zipt', kernel: kernel as never, opfs: opfs as never });
    expect(r1.partId).toBe(r2.partId);
    expect(r1.sourceFingerprint).toBe(r2.sourceFingerprint);
    expect(opfs.read).toHaveBeenCalledTimes(1);
    expect(kernel.loadFromBytes).toHaveBeenCalledTimes(1);
  });

  it('falls back to activePartId + djb2(activePartId) fingerprint when OPFS read throws', async () => {
    const kernel = makeKernel();
    const opfs = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockRejectedValue(new Error('not found in OPFS')),
    };
    const result = await loadDrawingSource({
      partPath: 'kernel-part-uuid-xyz.zipt',
      kernel: kernel as never,
      opfs: opfs as never,
      activePartId: 'kernel-part-uuid-xyz',
    });
    expect(result.partId).toBe('kernel-part-uuid-xyz');
    // Test-fixture path: fingerprint is djb2 of the partId string (acceptable only for synthetic paths)
    expect(typeof result.sourceFingerprint).toBe('string');
    expect(result.sourceFingerprint.length).toBeGreaterThan(0);
    expect(kernel.loadFromBytes).not.toHaveBeenCalled();
  });

  it('throws OPFS_READ_FAILED when OPFS read fails and no activePart fallback matches', async () => {
    const kernel = makeKernel();
    const opfs = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockRejectedValue(new Error('no such file')),
    };
    await expect(
      loadDrawingSource({ partPath: 'missing.zipt', kernel: kernel as never, opfs: opfs as never })
    ).rejects.toThrow('OPFS_READ_FAILED');
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/loadDrawingSource.spec.ts`
Expected RED: `Cannot find module '../loadDrawingSource'`.

**GREEN impl** — create `packages/app/src/drawing/loadDrawingSource.ts`:

```typescript
// packages/app/src/drawing/loadDrawingSource.ts
/**
 * Load a drawing's source part into the kernel and return the kernel part id
 * plus a content-based fingerprint of the source bytes.
 *
 * Called by CreateDrawingCommand.apply() immediately after creating the drawing.
 * Mirrors the assembly leaf-load pattern at App.tsx:3187-3189.
 *
 * Returns:
 *   partId           — kernel UUID from loadFromBytes (used by getProjectorInput).
 *   sourceFingerprint — djb2 hash of the raw OPFS bytes. Changes when the source
 *                       .zipt file changes → used by projectViewFromSource as
 *                       inputFingerprint and by the B5 staleness effect.
 *                       A kernel UUID is stable per-session, so hashing it would
 *                       NEVER detect edits — bytes are the correct content detector.
 *
 * Cache: module-level Map<partPath, { partId, sourceFingerprint }>. Keyed by OPFS
 * path so the same part opened N times in a session is only loaded once PER ACTIVATION
 * PASS. The cache must be cleared between drawing activations to pick up edits.
 * Use _clearLoadDrawingSourceCache() in tests; CreateDrawingCommand clears it on each apply().
 *
 * Fallback (test-fixture path): when OPFS read fails and partPath stem matches activePartId,
 * the part is already in the kernel. Returns { partId: activePartId, sourceFingerprint: djb2(activePartId) }.
 * The djb2(partId) fingerprint is acceptable ONLY here — real OPFS reads must hash bytes.
 */

/** djb2 over a string — browser-safe, synchronous. */
function djb2Str(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** djb2 over a Uint8Array — treats each byte as an unsigned integer. */
function djb2Bytes(bytes: Uint8Array): string {
  let h = 5381;
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) + h) ^ bytes[i]!;
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type LoadDrawingSourceResult = {
  /** Kernel UUID from loadFromBytes — pass to getProjectorInput({ kind: 'part', partId }). */
  partId: string;
  /** djb2 hash of raw OPFS bytes (REAL path) or djb2 of partId (fallback test path only).
   *  Changes whenever the source .zipt file changes → staleness detection is reliable. */
  sourceFingerprint: string;
};

const cache = new Map<string, LoadDrawingSourceResult>(); // partPath → result

export type KernelForLoad = {
  loadFromBytes(bytes: Uint8Array): Promise<string>;
  execute(partId: string): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
};

export type OpfsForLoad = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
};

export type LoadDrawingSourceArgs = {
  partPath: string;
  kernel: KernelForLoad;
  opfs: OpfsForLoad;
  /** Kernel id of the currently-active part (if any), used as fallback when OPFS read fails. */
  activePartId?: string;
};

export async function loadDrawingSource(args: LoadDrawingSourceArgs): Promise<LoadDrawingSourceResult> {
  const { partPath, kernel, opfs, activePartId } = args;

  // Cache hit: already loaded this activation pass
  const cached = cache.get(partPath);
  if (cached !== undefined) return cached;

  try {
    // REAL PATH: hash bytes for a content-based fingerprint, then load into kernel.
    const bytes = await opfs.read(partPath);
    const sourceFingerprint = djb2Bytes(bytes);  // changes on any source edit
    const partId = await kernel.loadFromBytes(bytes);
    const res = await kernel.execute(partId);
    if (!res.ok) {
      throw new Error(`kernel.execute failed: ${String((res as { error?: unknown }).error)}`);
    }
    const result: LoadDrawingSourceResult = { partId, sourceFingerprint };
    cache.set(partPath, result);
    return result;
  } catch (opfsErr) {
    // FALLBACK (test-fixture path): source.partPath = `${partId}.zipt` where partId is a
    // kernel UUID already in the cache (no real OPFS file). The part geometry is warm.
    // Fingerprint is djb2 of the partId — acceptable ONLY here since fixtures don't exercise
    // real edits. Real OPFS reads always hash bytes (above).
    const stem = partPath.replace(/\.[^.]+$/, '');
    if (activePartId && stem === activePartId) {
      const result: LoadDrawingSourceResult = {
        partId: activePartId,
        sourceFingerprint: djb2Str(activePartId),  // synthetic; test-fixture path only
      };
      cache.set(partPath, result);
      return result;
    }
    throw new Error(`OPFS_READ_FAILED: cannot load source part "${partPath}": ${String(opfsErr)}`);
  }
}

/** Exposed for testing + for CreateDrawingCommand to clear stale cache between activations. */
export function _clearLoadDrawingSourceCache(): void {
  cache.clear();
}
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/loadDrawingSource.spec.ts`
Expected GREEN: 6 tests pass.

**Commit:** `feat(projection-pipeline): B0.2 — loadDrawingSource returns { partId, sourceFingerprint } (bytes hash)`

---

### Task 0.3 — `CreateDrawingCommand` calls `loadDrawingSource` and sets both source slots

**Failing test name:** `CreateDrawingCommand — apply sets activeDrawingSourcePartId + activeDrawingSourceFingerprint after creating the drawing`

**RED test** — add to `packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`:

```typescript
// Add at top of file, after existing vi.mock blocks:
vi.mock('../../drawing/loadDrawingSource', () => ({
  loadDrawingSource: vi.fn().mockResolvedValue({ partId: 'kernel-part-uuid-from-load', sourceFingerprint: 'fp-bytes-hash-abc' }),
  _clearLoadDrawingSourceCache: vi.fn(),
}));

// Inside describe('CreateDrawingCommand'), add:
it('apply sets activeDrawingSourcePartId + activeDrawingSourceFingerprint from loadDrawingSource when sourceKind is part', async () => {
  const cmd = new CreateDrawingCommand({
    sourcePath: 'parts/cabinet1.zipt',
    sourceKind: 'part',
  });
  useAppStore.setState({ kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);
  await cmd.apply();

  const s = useAppStore.getState() as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };
  expect(s.activeDrawingSourcePartId).toBe('kernel-part-uuid-from-load');
  expect(s.activeDrawingSourceFingerprint).toBe('fp-bytes-hash-abc');
});

it('apply does NOT set source slots when sourceKind is assembly', async () => {
  const cmd = new CreateDrawingCommand({
    sourcePath: 'assemblies/wardrobe.ziasm',
    sourceKind: 'assembly',
  });
  await cmd.apply();

  const s = useAppStore.getState() as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };
  expect(s.activeDrawingSourcePartId).toBeNull();
  expect(s.activeDrawingSourceFingerprint).toBeNull();
});

it('revert resets both source slots to null', async () => {
  const cmd = new CreateDrawingCommand({
    sourcePath: 'parts/cabinet1.zipt',
    sourceKind: 'part',
  });
  useAppStore.setState({ kernel: { loadFromBytes: vi.fn(), execute: vi.fn() } as never } as never);
  await cmd.apply();
  await cmd.revert();

  const s = useAppStore.getState() as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };
  expect(s.activeDrawingSourcePartId).toBeNull();
  expect(s.activeDrawingSourceFingerprint).toBeNull();
});
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/CreateDrawingCommand.spec.ts`
Expected RED: new tests fail because `CreateDrawingCommand` doesn't call `loadDrawingSource`.

**GREEN impl** — edit `packages/app/src/commands/CreateDrawingCommand.ts`:

```typescript
import type { Command } from './Command';
import type { DrawingDocument, DrawingSheet, SheetSize } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import type { ActiveDocument } from '../store/useAppStore';

export class CreateDrawingCommand implements Command {
  readonly name = 'CreateDrawing';
  private prevActiveDocument: ActiveDocument | null = null;
  private prevActiveDrawingSourcePartId: string | null = null;
  private prevActiveDrawingSourceFingerprint: string | null = null;
  private createdId: string | null = null;

  constructor(
    private readonly opts: {
      sourcePath: string;
      sourceKind: 'part' | 'assembly';
      sheetSize?: SheetSize;
      orientation?: 'landscape' | 'portrait';
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    this.prevActiveDocument = state.activeDocument;
    const prevSlots = state as unknown as {
      activeDrawingSourcePartId: string | null;
      activeDrawingSourceFingerprint: string | null;
    };
    this.prevActiveDrawingSourcePartId = prevSlots.activeDrawingSourcePartId;
    this.prevActiveDrawingSourceFingerprint = prevSlots.activeDrawingSourceFingerprint;

    const sheetId = crypto.randomUUID();
    const drawingId = crypto.randomUUID();
    this.createdId = drawingId;

    const size: SheetSize = this.opts.sheetSize ?? { kind: 'iso', size: 'A3' };

    const sheet: DrawingSheet = {
      id: sheetId,
      name: 'Sheet 1',
      size,
      orientation: this.opts.orientation ?? 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    };

    const doc: DrawingDocument = {
      id: drawingId,
      name: `${this.opts.sourcePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'Drawing'} — Drawing`,
      units: 'mm',
      source: {
        partPath: this.opts.sourcePath,
        sourceKind: this.opts.sourceKind,
      },
      properties: {},
      sheets: [sheet],
      activeSheetId: sheetId,
    };

    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: doc });

    // Load the source part into the kernel so projection commands can call
    // getProjectorInput without a cache miss. Only for part-sourced drawings —
    // assembly-sourced drawings use a different load path (future work).
    if (this.opts.sourceKind === 'part') {
      try {
        const { loadDrawingSource, _clearLoadDrawingSourceCache } = await import('../drawing/loadDrawingSource');
        const { Opfs } = await import('../storage/Opfs');
        const kernel = useAppStore.getState().kernel;
        if (kernel) {
          const opfs = await Opfs.forNavigator();
          // Clear the module-level cache so re-activating the same drawing picks up
          // any edits made since the last activation (fresh OPFS read each time).
          _clearLoadDrawingSourceCache();
          const activePartId = useAppStore.getState().activePart?.id;
          const { partId, sourceFingerprint } = await loadDrawingSource({
            partPath: this.opts.sourcePath,
            kernel,
            opfs,
            activePartId,
          });
          useAppStore.setState({
            activeDrawingSourcePartId: partId,
            activeDrawingSourceFingerprint: sourceFingerprint,
          } as never);
        }
      } catch (e) {
        // Non-fatal: source part failed to load. Views will throw PART_NOT_IN_STORE
        // when the user tries to place them; the user can retry.
        console.warn('[CreateDrawingCommand] source part load failed:', (e as Error).message);
      }
    }

    // Persist to OPFS — fire-and-forget; errors surface in production via status bar
    try {
      const { saveDrawingToOpfs } = await import('../storage/saveDrawingToOpfs');
      await saveDrawingToOpfs(doc);
    } catch {
      // Non-fatal: drawing is in memory; user will be prompted to save explicitly
    }
  }

  async revert(): Promise<void> {
    useAppStore.getState().setActiveDocument(this.prevActiveDocument);
    useAppStore.setState({
      activeDrawingSourcePartId: this.prevActiveDrawingSourcePartId,
      activeDrawingSourceFingerprint: this.prevActiveDrawingSourceFingerprint,
    } as never);

    if (this.createdId) {
      const id = this.createdId;
      this.createdId = null;
      try {
        const { deleteDrawingFromOpfs } = await import('../storage/deleteDrawingFromOpfs');
        await deleteDrawingFromOpfs(id);
      } catch {
        // Non-fatal: best-effort cleanup
      }
    }
  }
}
```

**Note:** `Opfs.forNavigator()` is used in test-incompatible environments. The `vi.mock('../../drawing/loadDrawingSource')` in the test stubs the entire module, so `loadDrawingSource` never actually runs in unit tests. The `kernel` check (`if (kernel)`) means the load is skipped in tests that don't inject a kernel (existing tests set `kernel: null`).

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/CreateDrawingCommand.spec.ts`
Expected GREEN: all tests pass.

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `feat(projection-pipeline): B0.3 — CreateDrawingCommand loads source part, sets activeDrawingSourcePartId + activeDrawingSourceFingerprint`

---

## Batch 1 — `fingerprintPartState` + `projectViewFromSource` + `AddBaseViewCommand` projection + placeBase wiring

### Task 1.1 — `fingerprintPartState` (shared, synchronous djb2)

**No-TDD exception:** new pure function with no store/kernel dependencies; unit test is written first per TDD, but there is no pre-existing failing test to name — the failing test IS Task 1.1's test.

**RED test** — create `packages/app/src/drawing/__tests__/fingerprintPartState.spec.ts`:

```typescript
// packages/app/src/drawing/__tests__/fingerprintPartState.spec.ts
import { describe, it, expect } from 'vitest';
import { fingerprintPartState } from '../fingerprintPartState';
import type { PartDocument } from '@zilventor/shared';

function makePart(overrides?: Partial<PartDocument>): PartDocument {
  return {
    id: 'p1', name: 'Part', units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
    ...overrides,
  };
}

describe('fingerprintPartState', () => {
  it('returns a non-empty string', () => {
    expect(typeof fingerprintPartState(makePart())).toBe('string');
    expect(fingerprintPartState(makePart()).length).toBeGreaterThan(0);
  });

  it('same featureTree + parameters → same hash', () => {
    const a = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    const b = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    expect(fingerprintPartState(a)).toBe(fingerprintPartState(b));
  });

  it('different featureTree → different hash', () => {
    const a = makePart({ featureTree: [{ id: 'f1', kind: 'extrude' } as never] });
    const b = makePart({ featureTree: [{ id: 'f2', kind: 'extrude' } as never] });
    expect(fingerprintPartState(a)).not.toBe(fingerprintPartState(b));
  });

  it('different parameters → different hash', () => {
    const a = makePart({ parameters: { w: { name: 'w', value: 10, unit: 'mm' } as never } });
    const b = makePart({ parameters: { w: { name: 'w', value: 20, unit: 'mm' } as never } });
    expect(fingerprintPartState(a)).not.toBe(fingerprintPartState(b));
  });

  it('name/id/materials changes do NOT change the hash (only featureTree+parameters matter)', () => {
    const a = makePart({ id: 'p1', name: 'A', materials: [] });
    const b = makePart({ id: 'p2', name: 'B', materials: [{ id: 'm1', name: 'Oak', defaultThickness: 18, color: '#fff' }] });
    expect(fingerprintPartState(a)).toBe(fingerprintPartState(b));
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/fingerprintPartState.spec.ts`
Expected RED: `Cannot find module '../fingerprintPartState'`.

**GREEN impl** — create `packages/app/src/drawing/fingerprintPartState.ts`:

```typescript
// packages/app/src/drawing/fingerprintPartState.ts
import type { PartDocument } from '@zilventor/shared';

/** djb2 hash — browser-safe, synchronous. Matches fingerprint.ts convention. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Synchronous fingerprint of a part's feature-tree and parameter state.
 * Hashes only `featureTree` and `parameters` — the two fields that change
 * when a part is edited. Name, id, materials, hardware are excluded so
 * metadata changes don't flag views as stale.
 *
 * Used by:
 *   - projectViewFromSource (at projection time, to record the source state)
 *   - DrawingCanvas activation effect (to detect staleness on drawing open)
 */
export function fingerprintPartState(partDoc: PartDocument): string {
  const payload = JSON.stringify({
    featureTree: partDoc.featureTree,
    parameters: partDoc.parameters,
  });
  return djb2(payload);
}
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/fingerprintPartState.spec.ts`
Expected GREEN: 5 tests pass.

**Commit:** `feat(projection-pipeline): fingerprintPartState — synchronous djb2 of featureTree+parameters`

---

### Task 1.2 — `projectViewFromSource` helper (unit test with mocked kernel)

**Failing test name:** `projectViewFromSource — throws KERNEL_NOT_READY when kernel is null`

**Key changes from original plan:**

1. **Fingerprint source (THE FLAW FIX):** reads `activeDrawingSourceFingerprint` (set by B0's `loadDrawingSource` from raw OPFS bytes) as `inputFingerprint`. The original plan computed `djb2(activeDrawingSourcePartId)` — but a kernel UUID is STABLE for the loaded part file, so that hash NEVER changes even after a source edit. Staleness can never fire with that approach. The fix: use the bytes-hash fingerprint from the `activeDrawingSourceFingerprint` store slot instead.

2. **`getProjectorInput` returns null, not throws:** confirmed at `packages/kernel/src/api.ts:93` — return type is `Promise<ProjectorInput | null>`. Null is returned when the part is not in the kernel's `namedShapeCache`. The helper must check for null → throw `GEOMETRY_NOT_CACHED`.

**Priority order for partId + fingerprint:**

| State | partId source | fingerprint source |
|---|---|---|
| Live app (drawing active, `activePart` null) | `activeDrawingSourcePartId` | `activeDrawingSourceFingerprint` (bytes hash from B0) |
| Unit-test path (`activePart` set, source slots null) | `activePart.id` | `fingerprintPartState(activePart)` |
| Both null | — | throw `PART_NOT_IN_STORE` |

This ensures staleness works: `inputFingerprint` stored on the view = bytes hash at projection time. B5 compares against `activeDrawingSourceFingerprint` = bytes hash at re-activation. If the source file changed, hashes differ → view flagged stale.

**RED test** — create `packages/app/src/drawing/__tests__/projectViewFromSource.spec.ts`:

```typescript
// packages/app/src/drawing/__tests__/projectViewFromSource.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { projectViewFromSource } from '../projectViewFromSource';
import type { PartDocument } from '@zilventor/shared';

vi.mock('../../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useAppStore')>();
  return { ...actual };
});

const MOCK_PROJECTOR_INPUT = {
  triangles: [[[0,0,0],[1,0,0],[0,1,0]]] as [[number,number,number],[number,number,number],[number,number,number]][],
  edges: [{ id: 'e0', points: [[0,0,0],[1,0,0]] as [number,number,number][], adjacentFaces: [] }],
  bbox: [0, 0, 0, 1, 1, 1] as [number,number,number,number,number,number],
};

const MOCK_PART: PartDocument = {
  id: 'test-part-uuid', name: 'Test', units: 'mm',
  parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
};

const MOCK_KERNEL_PART_ID = 'kernel-part-uuid-abc';
const MOCK_SOURCE_FINGERPRINT = 'fp-bytes-hash-abc123';

describe('projectViewFromSource', () => {
  beforeEach(() => {
    useAppStore.setState({
      kernel: null,
      activePart: null,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
    } as never);
  });

  it('throws KERNEL_NOT_READY when kernel is null', async () => {
    useAppStore.setState({
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('KERNEL_NOT_READY');
  });

  it('throws PART_NOT_IN_STORE when both activeDrawingSourcePartId and activePart are null', async () => {
    const mockKernel = { getProjectorInput: vi.fn() };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activePart: null,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('PART_NOT_IN_STORE');
  });

  it('uses activeDrawingSourcePartId + activeDrawingSourceFingerprint in live-app path', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
      activePart: null,
    } as never);

    const result = await projectViewFromSource('front');
    expect(result.projection).toBeDefined();
    expect(result.projection.visibleEdges).toBeDefined();
    expect(result.projection.bbox).toBeDefined();
    // inputFingerprint MUST equal activeDrawingSourceFingerprint (bytes hash), NOT djb2(kernelId)
    expect(result.inputFingerprint).toBe(MOCK_SOURCE_FINGERPRINT);
    expect(mockKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'part', partId: MOCK_KERNEL_PART_ID });
  });

  it('different activeDrawingSourceFingerprint → different inputFingerprint (staleness trigger)', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: 'fp-version-1',
      activePart: null,
    } as never);
    const r1 = await projectViewFromSource('front');

    // Simulate source edit: fingerprint changes (new bytes in the .zipt)
    useAppStore.setState({ activeDrawingSourceFingerprint: 'fp-version-2' } as never);
    const r2 = await projectViewFromSource('front');

    expect(r1.inputFingerprint).toBe('fp-version-1');
    expect(r2.inputFingerprint).toBe('fp-version-2');
    // B5 comparison: r1.inputFingerprint !== activeDrawingSourceFingerprint → view is stale
    expect(r1.inputFingerprint).not.toBe(r2.inputFingerprint);
  });

  it('falls back to activePart.id + fingerprintPartState when source slots are null (unit-test path)', async () => {
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(MOCK_PROJECTOR_INPUT),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: null,
      activeDrawingSourceFingerprint: null,
      activePart: MOCK_PART,
    } as never);

    const result = await projectViewFromSource('front');
    expect(mockKernel.getProjectorInput).toHaveBeenCalledWith({ kind: 'part', partId: 'test-part-uuid' });
    expect(typeof result.inputFingerprint).toBe('string');
    expect(result.inputFingerprint.length).toBeGreaterThan(0);
  });

  it('throws GEOMETRY_NOT_CACHED when getProjectorInput returns null (part not in kernel cache)', async () => {
    // NOTE: getProjectorInput returns null (NOT throws) on cache miss — api.ts:93 confirms this.
    const mockKernel = {
      getProjectorInput: vi.fn().mockResolvedValue(null),
    };
    useAppStore.setState({
      kernel: mockKernel as never,
      activeDrawingSourcePartId: MOCK_KERNEL_PART_ID,
      activeDrawingSourceFingerprint: MOCK_SOURCE_FINGERPRINT,
      activePart: null,
    } as never);
    await expect(projectViewFromSource('front')).rejects.toThrow('GEOMETRY_NOT_CACHED');
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/projectViewFromSource.spec.ts`
Expected RED: `Cannot find module '../projectViewFromSource'`.

**GREEN impl** — create `packages/app/src/drawing/projectViewFromSource.ts`:

```typescript
// packages/app/src/drawing/projectViewFromSource.ts
import { projectView } from '@zilventor/shared/src/drawing/projector';
import type { ViewOrientation } from '@zilventor/shared/src/drawing/viewMatrix';
import type { ProjectedGeometry } from '@zilventor/shared/src/drawing/projectedGeometry';
import { useAppStore } from '../store/useAppStore';
import { fingerprintPartState } from './fingerprintPartState';

export type ProjectViewResult = {
  projection: ProjectedGeometry;
  inputFingerprint: string;
};

/**
 * Shared async helper called by AddBaseViewCommand, AddProjectedViewCommand,
 * AddIsoViewCommand, and handleRegenerate.
 *
 * Kernel partId resolution (in priority order):
 *   1. state.activeDrawingSourcePartId  — set by B0 (CreateDrawingCommand → loadDrawingSource).
 *      This is the live-app path. drawingDocState() sets activePart=null, so we cannot
 *      use activePart.id here in production.
 *   2. state.activePart?.id             — fallback for unit tests that inject activePart
 *      directly via setState (mirrors existing test fixture pattern).
 *
 * inputFingerprint resolution (parallel to partId):
 *   1. state.activeDrawingSourceFingerprint — djb2 hash of raw OPFS bytes (set by B0
 *      loadDrawingSource). Changes when the source .zipt file changes → staleness works.
 *      MUST NOT be replaced with djb2(kernelId): kernel UUIDs are session-stable and would
 *      never change on source edits.
 *   2. fingerprintPartState(activePart) — fallback for unit-test path.
 *
 * Throws 'KERNEL_NOT_READY' if kernel is null.
 * Throws 'PART_NOT_IN_STORE' if both activeDrawingSourcePartId and activePart are null.
 * Throws 'GEOMETRY_NOT_CACHED' if getProjectorInput returns null (part not in cache).
 *   NOTE: getProjectorInput returns null — NOT throws — on cache miss (api.ts:93).
 */
export async function projectViewFromSource(
  orientation: ViewOrientation,
): Promise<ProjectViewResult> {
  const state = useAppStore.getState();

  const kernel = state.kernel;
  if (!kernel) throw new Error('KERNEL_NOT_READY: kernel not initialized');

  const sourceFp = state as unknown as {
    activeDrawingSourcePartId: string | null;
    activeDrawingSourceFingerprint: string | null;
  };

  // Resolve kernel partId: live path first, then test fallback.
  const kernelId: string | null =
    sourceFp.activeDrawingSourcePartId ??
    state.activePart?.id ??
    null;

  if (!kernelId) {
    throw new Error(
      'PART_NOT_IN_STORE: activeDrawingSourcePartId is null and activePart is null. ' +
      'Ensure the drawing source part was loaded via CreateDrawingCommand (B0) before placing views.'
    );
  }

  // getProjectorInput returns null when the part is not in the kernel's namedShapeCache.
  // It does NOT throw. Return value contract confirmed at packages/kernel/src/api.ts:93.
  const input = await kernel.getProjectorInput({ kind: 'part', partId: kernelId });
  if (input === null) {
    throw new Error(
      `GEOMETRY_NOT_CACHED: kernel.getProjectorInput returned null for partId "${kernelId}". ` +
      'The source part is not in the kernel cache. Ensure loadDrawingSource (B0) loaded and executed it.'
    );
  }

  const projection = projectView(input, orientation);

  // Fingerprint: live-app path reads activeDrawingSourceFingerprint (bytes hash from OPFS, B0).
  // Fallback for unit-test path: fingerprintPartState(activePart) — featureTree+parameters hash.
  const inputFingerprint =
    sourceFp.activeDrawingSourceFingerprint ??
    (state.activePart ? fingerprintPartState(state.activePart) : kernelId);

  return { projection, inputFingerprint };
}
```

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/projectViewFromSource.spec.ts`
Expected GREEN: 6 tests pass.

**Commit:** `feat(projection-pipeline): projectViewFromSource — reads activeDrawingSourceFingerprint (bytes hash, not djb2(kernelId))`

---

### Task 1.3 — `AddBaseViewCommand` stores real projection

**Failing test name:** `AddBaseViewCommand — apply stores projection and inputFingerprint when kernel returns geometry`

**RED test** — add to `packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts`:

```typescript
// Add imports at top of existing spec:
import { vi } from 'vitest';

// Add vi.mock for projectViewFromSource before describe blocks:
vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'proj-e0', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
    inputFingerprint: 'mock-fp-abc',
  }),
}));

// Add new test inside describe('AddBaseViewCommand'):
it('apply stores projection and inputFingerprint from projectViewFromSource', async () => {
  const cmd = new AddBaseViewCommand({
    sheetId: 'sheet-1',
    positionMm: { x: 50, y: 60 },
    orientation: 'front',
    scale: { numerator: 1, denominator: 1 },
  });
  await cmd.apply();

  const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
  const view = doc.sheets[0]!.views[0]!;
  if (view.kind !== 'base') return;
  expect(view.projection).toBeDefined();
  expect(view.projection?.visibleEdges).toHaveLength(1);
  expect(view.inputFingerprint).toBe('mock-fp-abc');
});

it('revert removes the view even when projection was stored', async () => {
  const cmd = new AddBaseViewCommand({
    sheetId: 'sheet-1',
    positionMm: { x: 50, y: 60 },
    orientation: 'top',
    scale: { numerator: 1, denominator: 2 },
  });
  await cmd.apply();
  await cmd.revert();

  const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
  expect(doc.sheets[0]!.views).toHaveLength(0);
});
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddBaseViewCommand.spec.ts`
Expected RED: new tests fail because `AddBaseViewCommand.apply()` does not call `projectViewFromSource`.

**GREEN impl** — edit `packages/app/src/commands/AddBaseViewCommand.ts`:

```typescript
import type { Command } from './Command';
import type { DrawingDocument, ViewScale, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';
import { projectViewFromSource } from '../drawing/projectViewFromSource';

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';

export class AddBaseViewCommand implements Command {
  readonly name = 'AddBaseView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      orientation: BaseOrient;
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    // Project the source geometry via the kernel.
    // Throws KERNEL_NOT_READY or PART_NOT_IN_STORE if not ready.
    const { projection, inputFingerprint } = await projectViewFromSource(this.opts.orientation);

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: BaseView = {
      id: newId,
      kind: 'base',
      positionMm: this.opts.positionMm,
      orientation: this.opts.orientation,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? true,
      projection,
      inputFingerprint,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.newViewId = null;
  }
}
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddBaseViewCommand.spec.ts`
Expected GREEN: all tests pass (old tests that check `projection === undefined` will now FAIL — they must be updated to reflect that `projection` is now set).

**Update old tests:** the existing `'apply appends a base view with correct fields and undefined projection'` test asserts `view.projection` is undefined. Since `projectViewFromSource` is mocked at the top of the spec, update the existing test to expect a defined projection:

```typescript
// Replace the assertion:
expect(view.projection).toBeUndefined();
// With:
expect(view.projection).toBeDefined();
// And add:
expect(view.inputFingerprint).toBeDefined();
```

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `feat(projection-pipeline): AddBaseViewCommand.apply calls projectViewFromSource to store real projection`

---

### Task 1.4 — placeBase canvas wiring

**No-TDD note:** UI wiring in DrawingCanvas is a pure React event handler change. No dedicated unit test is practical (jsdom getBoundingClientRect returns 0 for SVGSVGElement). Verified via B6 Playwright e2e.

**Edit `packages/app/src/drawing/DrawingCanvas.tsx`:**

1. Add imports at top (after existing imports):
```typescript
import { AddBaseViewCommand } from '../commands/AddBaseViewCommand';
import { AddProjectedViewCommand } from '../commands/AddProjectedViewCommand';
import { AddIsoViewCommand } from '../commands/AddIsoViewCommand';
```

2. In `handleClick`, replace the no-op comment:
```typescript
// OLD (line ~838):
// Other modes (addRadial, addDiametric, addLeader, addBalloon, placeBase) → wired in Phase 8 batch 2
setClickAccum([]);
```

With:
```typescript
if (toolMode === 'placeBase') {
  const params = useToolModeStore.getState().pendingViewParams;
  if (params?.kind !== 'base') { setClickAccum([]); return; }
  const sheetPt = { x: svgX, y: svgY };
  void bus.execute(new AddBaseViewCommand({
    sheetId: sheet.id,
    positionMm: sheetPt,
    orientation: params.orientation,
    scale: { numerator: params.scale.n, denominator: params.scale.d },
  }));
  useToolModeStore.getState().reset();
  setClickAccum([]);
  return;
}

if (toolMode === 'placeProjected') {
  const params = useToolModeStore.getState().pendingViewParams;
  if (params?.kind !== 'projected') { setClickAccum([]); return; }
  const sheetPt = { x: svgX, y: svgY };
  void bus.execute(new AddProjectedViewCommand({
    sheetId: sheet.id,
    baseViewId: params.baseViewId,
    direction: params.direction,
    positionMm: sheetPt,
  }));
  useToolModeStore.getState().reset();
  setClickAccum([]);
  return;
}

if (toolMode === 'placeIso') {
  const params = useToolModeStore.getState().pendingViewParams;
  if (params?.kind !== 'iso') { setClickAccum([]); return; }
  const sheetPt = { x: svgX, y: svgY };
  void bus.execute(new AddIsoViewCommand({
    sheetId: sheet.id,
    positionMm: sheetPt,
    corner: params.corner,
    scale: { numerator: params.scale.n, denominator: params.scale.d },
  }));
  useToolModeStore.getState().reset();
  setClickAccum([]);
  return;
}

// Other modes (addRadial, addDiametric, addLeader, addBalloon)
setClickAccum([]);
```

3. Update the `handleClick` useCallback deps to include the three new command classes (they're imported, not closured, so no dep change needed — but verify the existing dep array at :840 is still valid).

Run: `pnpm --filter app test:unit`
Expected GREEN (no compile errors; no behavior tests for this step).

**Commit:** `feat(projection-pipeline): wire placeBase/placeProjected/placeIso click branches in DrawingCanvas`

---

## Batch 2 — `deriveProjectedOrientation` + `AddProjectedViewCommand` projection

### Task 2.1 — `deriveProjectedOrientation` third-angle table

**Failing test name:** `deriveProjectedOrientation — front + right → right`

**RED test** — create `packages/shared/src/drawing/__tests__/deriveProjectedOrientation.spec.ts`:

```typescript
// packages/shared/src/drawing/__tests__/deriveProjectedOrientation.spec.ts
import { describe, it, expect } from 'vitest';
import { deriveProjectedOrientation } from '../deriveProjectedOrientation';

// Third-angle projection (ANSI): when looking at the FRONT view,
//   'top'    neighbour = view from ABOVE    → 'top'
//   'bottom' neighbour = view from BELOW    → 'bottom'
//   'right'  neighbour = view from RIGHT    → 'right'
//   'left'   neighbour = view from LEFT     → 'left'
//
// When the base view IS the top view, the 'top' neighbour is 'back',
// 'bottom' is 'front', 'right' is 'right', 'left' is 'left'.
//
// Full third-angle table (6 base orientations × 4 directions = 24 cases):

describe('deriveProjectedOrientation', () => {
  // Front base
  it('front + top    → top',    () => expect(deriveProjectedOrientation('front',  'top'   )).toBe('top'));
  it('front + bottom → bottom', () => expect(deriveProjectedOrientation('front',  'bottom')).toBe('bottom'));
  it('front + right  → right',  () => expect(deriveProjectedOrientation('front',  'right' )).toBe('right'));
  it('front + left   → left',   () => expect(deriveProjectedOrientation('front',  'left'  )).toBe('left'));

  // Top base (looking down from above)
  it('top + top    → back',    () => expect(deriveProjectedOrientation('top',  'top'   )).toBe('back'));
  it('top + bottom → front',   () => expect(deriveProjectedOrientation('top',  'bottom')).toBe('front'));
  it('top + right  → right',   () => expect(deriveProjectedOrientation('top',  'right' )).toBe('right'));
  it('top + left   → left',    () => expect(deriveProjectedOrientation('top',  'left'  )).toBe('left'));

  // Right base (looking from the right side)
  it('right + top    → top',    () => expect(deriveProjectedOrientation('right',  'top'   )).toBe('top'));
  it('right + bottom → bottom', () => expect(deriveProjectedOrientation('right',  'bottom')).toBe('bottom'));
  it('right + right  → back',   () => expect(deriveProjectedOrientation('right',  'right' )).toBe('back'));
  it('right + left   → front',  () => expect(deriveProjectedOrientation('right',  'left'  )).toBe('front'));

  // Back base
  it('back + top    → top',    () => expect(deriveProjectedOrientation('back',  'top'   )).toBe('top'));
  it('back + bottom → bottom', () => expect(deriveProjectedOrientation('back',  'bottom')).toBe('bottom'));
  it('back + right  → left',   () => expect(deriveProjectedOrientation('back',  'right' )).toBe('left'));
  it('back + left   → right',  () => expect(deriveProjectedOrientation('back',  'left'  )).toBe('right'));

  // Bottom base
  it('bottom + top    → front',  () => expect(deriveProjectedOrientation('bottom', 'top'   )).toBe('front'));
  it('bottom + bottom → back',   () => expect(deriveProjectedOrientation('bottom', 'bottom')).toBe('back'));
  it('bottom + right  → right',  () => expect(deriveProjectedOrientation('bottom', 'right' )).toBe('right'));
  it('bottom + left   → left',   () => expect(deriveProjectedOrientation('bottom', 'left'  )).toBe('left'));

  // Left base
  it('left + top    → top',    () => expect(deriveProjectedOrientation('left', 'top'   )).toBe('top'));
  it('left + bottom → bottom', () => expect(deriveProjectedOrientation('left', 'bottom')).toBe('bottom'));
  it('left + right  → front',  () => expect(deriveProjectedOrientation('left', 'right' )).toBe('front'));
  it('left + left   → back',   () => expect(deriveProjectedOrientation('left', 'left'  )).toBe('back'));
});
```

Run: `pnpm --filter @zilventor/shared test:unit -- --run src/drawing/__tests__/deriveProjectedOrientation.spec.ts`
Expected RED: `Cannot find module '../deriveProjectedOrientation'`.

**GREEN impl** — create `packages/shared/src/drawing/deriveProjectedOrientation.ts`:

```typescript
// packages/shared/src/drawing/deriveProjectedOrientation.ts
// Third-angle orthographic projection neighbour table (ANSI standard).
// Given a base view's orientation and the direction the user clicked relative
// to it, returns the orientation of the projected view.

type BaseOrient = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
type Direction = 'top' | 'bottom' | 'left' | 'right';
import type { ViewOrientation } from './viewMatrix';

const TABLE: Record<BaseOrient, Record<Direction, ViewOrientation>> = {
  front:  { top: 'top',    bottom: 'bottom', right: 'right', left: 'left'   },
  top:    { top: 'back',   bottom: 'front',  right: 'right', left: 'left'   },
  right:  { top: 'top',    bottom: 'bottom', right: 'back',  left: 'front'  },
  back:   { top: 'top',    bottom: 'bottom', right: 'left',  left: 'right'  },
  bottom: { top: 'front',  bottom: 'back',   right: 'right', left: 'left'   },
  left:   { top: 'top',    bottom: 'bottom', right: 'front', left: 'back'   },
};

/**
 * Derive the ViewOrientation of a projected view in third-angle (ANSI) projection.
 * @param baseOrientation - orientation of the parent base view
 * @param direction - position of projected view relative to base ('top'=above, etc.)
 * @returns the ViewOrientation to pass to projectView()
 */
export function deriveProjectedOrientation(
  baseOrientation: BaseOrient,
  direction: Direction,
): ViewOrientation {
  return TABLE[baseOrientation][direction];
}
```

Run: `pnpm --filter @zilventor/shared test:unit -- --run src/drawing/__tests__/deriveProjectedOrientation.spec.ts`
Expected GREEN: 24 tests pass.

**Commit:** `feat(projection-pipeline): deriveProjectedOrientation — exhaustive third-angle table (24 cases)`

---

### Task 2.2 — `AddProjectedViewCommand` stores real projection

**Failing test name:** `AddProjectedViewCommand — apply stores projection and inputFingerprint`

**RED test** — add to `packages/app/src/commands/__tests__/AddProjectedViewCommand.spec.ts`:

```typescript
// Add at top of file:
import { vi } from 'vitest';

// Add vi.mock before describe blocks:
vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'proj-right-e0', kind: 'outline', points: [[0,0],[30,0],[30,50],[0,50],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 30, maxY: 50 },
    },
    inputFingerprint: 'mock-proj-fp',
  }),
}));

// Also mock deriveProjectedOrientation to keep test isolated:
vi.mock('@zilventor/shared/src/drawing/deriveProjectedOrientation', () => ({
  deriveProjectedOrientation: vi.fn().mockReturnValue('right' as import('@zilventor/shared/src/drawing/viewMatrix').ViewOrientation),
}));

// Add new test inside describe('AddProjectedViewCommand'):
it('apply stores projection and inputFingerprint from projectViewFromSource', async () => {
  const cmd = new AddProjectedViewCommand({
    sheetId: 'sheet-1',
    baseViewId: 'base-1',
    direction: 'right',
    positionMm: { x: 200, y: 100 },
  });
  await cmd.apply();

  const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
  const pv = doc.sheets[0]!.views[1]!;
  if (pv.kind !== 'projected') return;
  expect(pv.projection).toBeDefined();
  expect(pv.projection?.visibleEdges).toHaveLength(1);
  expect(pv.inputFingerprint).toBe('mock-proj-fp');
});
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddProjectedViewCommand.spec.ts`
Expected RED: new test fails.

**GREEN impl** — edit `packages/app/src/commands/AddProjectedViewCommand.ts`:

```typescript
import type { Command } from './Command';
import type { DrawingDocument, ProjectedView, BaseView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';
import { projectViewFromSource } from '../drawing/projectViewFromSource';
import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';

export class AddProjectedViewCommand implements Command {
  readonly name = 'AddProjectedView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      baseViewId: string;
      direction: 'top' | 'bottom' | 'left' | 'right';
      positionMm: { x: number; y: number };
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const sheet = doc.document.sheets.find(s => s.id === this.opts.sheetId);
    if (!sheet) return;

    const baseView = sheet.views.find(
      (v): v is BaseView => v.id === this.opts.baseViewId && v.kind === 'base'
    );
    if (!baseView) {
      throw new Error(`BASE_VIEW_NOT_FOUND: no base view with id ${this.opts.baseViewId} on sheet ${this.opts.sheetId}`);
    }

    // Derive the orientation for the projected view from the base view's orientation.
    const orientation = deriveProjectedOrientation(baseView.orientation, this.opts.direction);

    const { projection, inputFingerprint } = await projectViewFromSource(orientation);

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: ProjectedView = {
      id: newId,
      kind: 'projected',
      positionMm: this.opts.positionMm,
      baseViewId: this.opts.baseViewId,
      direction: this.opts.direction,
      scale: baseView.scale,
      showHidden: baseView.showHidden,
      projection,
      inputFingerprint,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.newViewId = null;
  }
}
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddProjectedViewCommand.spec.ts`
Expected GREEN: all tests pass (the old test checking `pv.projection === undefined` must be updated to expect defined, same as Task 1.3).

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `feat(projection-pipeline): AddProjectedViewCommand uses deriveProjectedOrientation + projectViewFromSource`

---

## Batch 3 — `AddIsoViewCommand` projection

### Task 3.1 — `AddIsoViewCommand` stores real projection

**Failing test name:** `AddIsoViewCommand — apply stores projection and inputFingerprint for iso-NE`

**RED test** — add to `packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts`:

```typescript
// Add at top:
import { vi } from 'vitest';

// Add vi.mock before describe blocks:
vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'iso-e0', kind: 'outline', points: [[0,0],[40,0],[20,30],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    },
    inputFingerprint: 'mock-iso-fp',
  }),
}));

// Import projectViewFromSource for call verification:
import { projectViewFromSource } from '../../drawing/projectViewFromSource';

// Add new test inside describe('AddIsoViewCommand'):
it('apply stores projection and inputFingerprint; calls projectViewFromSource with iso-NE orientation', async () => {
  const cmd = new AddIsoViewCommand({
    sheetId: 'sheet-1',
    positionMm: { x: 200, y: 200 },
    corner: 'NE',
    scale: { numerator: 1, denominator: 1 },
  });
  await cmd.apply();

  const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
  const view = doc.sheets[0]!.views[0]!;
  if (view.kind !== 'iso') return;
  expect(view.projection).toBeDefined();
  expect(view.inputFingerprint).toBe('mock-iso-fp');
  expect(projectViewFromSource).toHaveBeenCalledWith('iso-NE');
});

it('apply calls projectViewFromSource with iso-SW for corner SW', async () => {
  const cmd = new AddIsoViewCommand({
    sheetId: 'sheet-1',
    positionMm: { x: 0, y: 0 },
    corner: 'SW',
    scale: { numerator: 1, denominator: 2 },
  });
  await cmd.apply();
  expect(projectViewFromSource).toHaveBeenCalledWith('iso-SW');
});
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddIsoViewCommand.spec.ts`
Expected RED: new tests fail.

**GREEN impl** — edit `packages/app/src/commands/AddIsoViewCommand.ts`:

```typescript
import type { Command } from './Command';
import type { DrawingDocument, ViewScale, IsoView } from '@zilventor/shared';
import type { ViewOrientation } from '@zilventor/shared/src/drawing/viewMatrix';
import { useAppStore } from '../store/useAppStore';
import { drawingDocState } from '../store/drawingDocState';
import { projectViewFromSource } from '../drawing/projectViewFromSource';

export class AddIsoViewCommand implements Command {
  readonly name = 'AddIsoView';
  private newViewId: string | null = null;

  constructor(
    private readonly opts: {
      sheetId: string;
      positionMm: { x: number; y: number };
      corner: 'NE' | 'NW' | 'SE' | 'SW';
      scale: ViewScale;
      showHidden?: boolean;
    }
  ) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    // corner → iso-<corner> matches ViewOrientation: 'iso-NE' | 'iso-NW' | 'iso-SE' | 'iso-SW'
    const orientation: ViewOrientation = `iso-${this.opts.corner}` as ViewOrientation;

    const { projection, inputFingerprint } = await projectViewFromSource(orientation);

    const newId = crypto.randomUUID();
    this.newViewId = newId;

    const view: IsoView = {
      id: newId,
      kind: 'iso',
      positionMm: this.opts.positionMm,
      corner: this.opts.corner,
      scale: this.opts.scale,
      showHidden: this.opts.showHidden ?? false,
      projection,
      inputFingerprint,
    };

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: [...s.views, view] }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
  }

  async revert(): Promise<void> {
    if (!this.newViewId) return;
    const state = useAppStore.getState();
    const doc = state.activeDocument;
    if (!doc || doc.kind !== 'drawing') return;

    const next: DrawingDocument = {
      ...doc.document,
      sheets: doc.document.sheets.map(s =>
        s.id === this.opts.sheetId
          ? { ...s, views: s.views.filter(v => v.id !== this.newViewId) }
          : s
      ),
    };
    useAppStore.setState(drawingDocState(next));
    this.newViewId = null;
  }
}
```

Run: `pnpm --filter app test:unit -- --run src/commands/__tests__/AddIsoViewCommand.spec.ts`
Expected GREEN: all tests pass (update old test's `view.projection === undefined` assertion to expect defined).

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `feat(projection-pipeline): AddIsoViewCommand maps corner to iso-<corner> orientation + projectViewFromSource`

---

## Batch 4 — Regenerate wiring (`handleRegenerate` → real re-projection)

### Task 4.1 — `handleRegenerate` dispatches `RegenerateViewCommand` with fresh geometry

**No-TDD note:** pure React callback change in `DrawingCanvas.tsx`. The behavior is verified via B6 Playwright e2e which clicks the stale marker and asserts updated edge counts. Unit-testing a `useCallback` that calls async bus.execute requires a complex React testing harness beyond what exists; consistent with the section/detail/break pattern where UI handlers are e2e-verified only.

**Edit `packages/app/src/drawing/DrawingCanvas.tsx`:**

1. Add additional imports at top of file (alongside the view placement imports added in Task 1.4):
```typescript
import { RegenerateViewCommand } from '../commands/RegenerateViewCommand';
import { projectViewFromSource } from './projectViewFromSource';
import type { ViewOrientation } from '@zilventor/shared/src/drawing/viewMatrix';
```

2. Replace the existing `handleRegenerate` callback (currently at ~line 842):

```typescript
// BEFORE:
const handleRegenerate = useCallback((viewId: string) => {
  setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
}, []);

// AFTER:
const handleRegenerate = useCallback((viewId: string) => {
  const view = sheet.views.find((v) => v.id === viewId);
  if (!view || view.kind === 'section' || view.kind === 'detail') {
    // Section/detail regenerate is out of scope for this pass (requires kernel re-cut).
    // Still clear the stale marker so the UI isn't permanently stuck.
    setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
    return;
  }

  // Derive orientation for the view.
  let orientation: ViewOrientation;
  if (view.kind === 'base') {
    orientation = view.orientation;
  } else if (view.kind === 'iso') {
    orientation = `iso-${view.corner}` as ViewOrientation;
  } else if (view.kind === 'projected') {
    // Use rawProjection or projection to infer orientation — but we have direction + baseView.
    const baseView = sheet.views.find(
      (v): v is import('@zilventor/shared').BaseView => v.id === view.baseViewId && v.kind === 'base'
    );
    if (!baseView) {
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }
    const { deriveProjectedOrientation } = require('@zilventor/shared/src/drawing/deriveProjectedOrientation') as
      typeof import('@zilventor/shared/src/drawing/deriveProjectedOrientation');
    orientation = deriveProjectedOrientation(baseView.orientation, view.direction);
  } else {
    setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
    return;
  }

  void (async () => {
    try {
      const { projection, inputFingerprint } = await projectViewFromSource(orientation);
      await bus.execute(new RegenerateViewCommand({
        sheetId: sheet.id,
        viewId,
        projection,
        inputFingerprint,
      }));
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
    } catch (err) {
      console.error('[handleRegenerate] failed:', err);
      // Do not clear the stale marker on error — leave it for the user to retry.
    }
  })();
}, [sheet, bus]);
```

**Note:** Using `require()` for `deriveProjectedOrientation` inside the callback avoids a React hook dep issue. A cleaner alternative is to import it statically at the top of the file — prefer static import:

Actually, replace the `require()` with a static import at the top of the file instead:
```typescript
import { deriveProjectedOrientation } from '@zilventor/shared/src/drawing/deriveProjectedOrientation';
```

And rewrite the projected branch without `require()`:
```typescript
  } else if (view.kind === 'projected') {
    const baseView = sheet.views.find(
      (v): v is import('@zilventor/shared').BaseView => v.id === view.baseViewId && v.kind === 'base'
    );
    if (!baseView) {
      setStaleViews((prev) => { const next = new Set(prev); next.delete(viewId); return next; });
      return;
    }
    orientation = deriveProjectedOrientation(baseView.orientation, view.direction);
  }
```

3. Update the `handleRegenerate` useCallback deps: `[sheet, bus]`.

Run: `pnpm --filter app test:unit`
Expected GREEN (no compilation errors in the changed files).

**Commit:** `feat(projection-pipeline): handleRegenerate dispatches RegenerateViewCommand with real re-projection`

---

## Batch 5 — Staleness: `inputFingerprint` at activation → mark stale

### Task 5.1 — Activation-time staleness detection in `DrawingCanvas`

**Failing test name:** TDD note — no dedicated unit test for the `useEffect` itself (DrawingCanvas activation effects are e2e-verified). However, the B5 unit test below asserts that `activeDrawingSourceFingerprint` drives staleness correctly when it diverges from a view's stored `inputFingerprint`. The existing T-6-4 e2e (condition a) must still pass.

**Key design change from original plan:** the staleness useEffect reads `activeDrawingSourceFingerprint` directly from the store — NOT `fingerprintPartState(source)`. Reasons:
1. `source` (`activePart ?? activeAssembly`) is always null in the live drawing context (reset by `drawingDocState()`). So `fingerprintPartState(source)` returns null and condition (b) never fires.
2. `activeDrawingSourceFingerprint` is a bytes-based hash set by `loadDrawingSource` (B0) from the actual OPFS file content. It is the correct staleness oracle: it changes whenever the `.zipt` file changes.
3. No additional OPFS read needed — the fingerprint was captured at load time, already in the store.

**B5 RED test** — add to a new file `packages/app/src/drawing/__tests__/drawingCanvasStaleness.spec.ts` (unit-testing the staleness logic, not the React component directly):

```typescript
// packages/app/src/drawing/__tests__/drawingCanvasStaleness.spec.ts
// Tests the staleness comparison logic exercised by the DrawingCanvas useEffect.
// Mirrors the logic without mounting React; the useEffect body is extracted into a
// pure helper `computeStaleViewIds` for testability.
import { describe, it, expect } from 'vitest';
import { computeStaleViewIds } from '../computeStaleViewIds';
import type { DrawingView } from '@zilventor/shared';

function makeView(id: string, opts: { hasProjection?: boolean; inputFingerprint?: string }): DrawingView {
  return {
    id,
    kind: 'base',
    positionMm: { x: 0, y: 0 },
    orientation: 'front',
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    ...(opts.hasProjection ? { projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } } } : {}),
    ...(opts.inputFingerprint !== undefined ? { inputFingerprint: opts.inputFingerprint } : {}),
  } as unknown as DrawingView;
}

describe('computeStaleViewIds', () => {
  it('returns empty set when activeDrawingSourceFingerprint is null (no source loaded)', () => {
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-a' })];
    expect(computeStaleViewIds(views, null)).toEqual(new Set());
  });

  it('condition (a): view with projection but no inputFingerprint is stale', () => {
    const views = [makeView('v1', { hasProjection: true })];
    const result = computeStaleViewIds(views, 'current-fp');
    expect(result).toEqual(new Set(['v1']));
  });

  it('condition (b): view inputFingerprint !== activeDrawingSourceFingerprint → stale (SOURCE EDIT DETECTED)', () => {
    // This is the primary staleness condition the original plan BROKE by using djb2(kernelId).
    // A kernel UUID never changes → djb2(kernelId) === djb2(kernelId) always → never stale.
    // activeDrawingSourceFingerprint changes on source edit (bytes changed) → this test fires.
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-old-bytes' })];
    const result = computeStaleViewIds(views, 'fp-new-bytes');
    expect(result).toEqual(new Set(['v1']));
  });

  it('condition (b) does NOT fire when fingerprints match (source unchanged)', () => {
    const views = [makeView('v1', { hasProjection: true, inputFingerprint: 'fp-same' })];
    const result = computeStaleViewIds(views, 'fp-same');
    expect(result).toEqual(new Set());
  });

  it('views without projection are never stale', () => {
    const views = [makeView('v1', { hasProjection: false })];
    const result = computeStaleViewIds(views, 'fp-a');
    expect(result).toEqual(new Set());
  });

  it('handles mixed views correctly', () => {
    const views = [
      makeView('stale-a', { hasProjection: true }), // condition (a)
      makeView('stale-b', { hasProjection: true, inputFingerprint: 'fp-old' }), // condition (b)
      makeView('fresh', { hasProjection: true, inputFingerprint: 'fp-current' }), // not stale
      makeView('no-proj', { hasProjection: false }), // unprojected
    ];
    const result = computeStaleViewIds(views, 'fp-current');
    expect(result).toEqual(new Set(['stale-a', 'stale-b']));
  });
});
```

**GREEN impl — Step 1:** Create `packages/app/src/drawing/computeStaleViewIds.ts` (pure function extracted for testability):

```typescript
// packages/app/src/drawing/computeStaleViewIds.ts
import type { DrawingView } from '@zilventor/shared';

/**
 * Pure helper: computes the set of view ids that are stale given the current source fingerprint.
 *
 * Extracted from the DrawingCanvas activation useEffect for testability.
 *
 * @param views - all views on the active sheet
 * @param activeDrawingSourceFingerprint - djb2 hash of the source part's OPFS bytes, set by
 *   loadDrawingSource (B0). Null when no drawing is active or the source part has not loaded.
 *   NOTE: do NOT pass fingerprintPartState(activePart) here — activePart is null in the live
 *   drawing context. Use the store's activeDrawingSourceFingerprint slot instead.
 *
 * Staleness conditions:
 *   (a) view.projection exists but view.inputFingerprint is absent (legacy / hand-injected)
 *   (b) view.inputFingerprint !== activeDrawingSourceFingerprint (source bytes changed)
 *
 * Returns an empty set when activeDrawingSourceFingerprint is null (no source loaded yet).
 */
export function computeStaleViewIds(
  views: DrawingView[],
  activeDrawingSourceFingerprint: string | null,
): Set<string> {
  const stale = new Set<string>();
  for (const v of views) {
    if (!v.projection) continue; // unprojected views can't be stale
    if (!v.inputFingerprint) {
      stale.add(v.id); // (a) legacy: no fingerprint at all
    } else if (activeDrawingSourceFingerprint && v.inputFingerprint !== activeDrawingSourceFingerprint) {
      stale.add(v.id); // (b) fingerprint mismatch: source bytes changed since view was placed
    }
  }
  return stale;
}
```

**GREEN impl — Step 2:** Edit `packages/app/src/drawing/DrawingCanvas.tsx`:

Replace the existing stale-detection `useEffect` (currently ~line 141–149):

```typescript
// BEFORE:
// Detect stale views on mount (views with projection but no fingerprint)
useEffect(() => {
  const stale = new Set<string>();
  for (const v of sheet.views) {
    if (v.projection && !v.inputFingerprint) stale.add(v.id);
  }
  setStaleViews(stale);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [drawing.id, sheet.id]);

// AFTER:
// Detect stale views on drawing activation / source fingerprint change.
// Reads activeDrawingSourceFingerprint (bytes hash set by loadDrawingSource in B0).
// Uses computeStaleViewIds() for the two staleness conditions.
//
// NOTE: do NOT use fingerprintPartState(activePart) here — activePart is null in the live
// drawing context (reset by drawingDocState). The bytes-based fingerprint slot is correct.
useEffect(() => {
  setStaleViews(computeStaleViewIds(sheet.views, activeDrawingSourceFingerprint));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [drawing.id, sheet.id, activeDrawingSourceFingerprint]);
```

Add imports at top of `DrawingCanvas.tsx`:
```typescript
import { computeStaleViewIds } from './computeStaleViewIds';
```

Add the `activeDrawingSourceFingerprint` selector alongside other store selectors in `DrawingCanvas.tsx`:
```typescript
const activeDrawingSourceFingerprint = useAppStore(
  (s) => (s as unknown as { activeDrawingSourceFingerprint: string | null }).activeDrawingSourceFingerprint
);
```

Remove the no-longer-needed `source` selector (`activePart ?? activeAssembly`) if it was added solely for the staleness fingerprint. (Keep it if other parts of `DrawingCanvas` need it.) Remove the `fingerprintPartState` import if it is no longer used in `DrawingCanvas.tsx`.

Run: `pnpm --filter app test:unit -- --run src/drawing/__tests__/drawingCanvasStaleness.spec.ts`
Expected GREEN: 6 tests pass (condition (b) now fires on source-fingerprint mismatch).

Run: `pnpm --filter app test:unit`
Expected GREEN.

Run: verify T-6-4 e2e (staleness test) still passes:
```
pnpm --filter app exec playwright test tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
```
Expected: PASS (T-6-4 seeds a view with `projection && !inputFingerprint`, which matches condition (a); `activeDrawingSourceFingerprint` is null in the test fixture so (b) never fires, which is correct).

**Commit:** `feat(projection-pipeline): staleness reads activeDrawingSourceFingerprint (bytes hash) not fingerprintPartState`

---

### Task 5.2 — `fingerprintPartState` perf probe registration in App.tsx (T63h)

**No-TDD note:** perf probes follow the existing T62/T63 pattern — register a `__zilventor*` global via `useEffect` in `App.tsx`, then call it from a unit test in `perfProbe.spec.ts`. Not a feature change; follows established pattern.

**Edit `packages/app/src/App.tsx`:**

Inside the drawing perf hooks `useEffect` (around line 3020, just before the cleanup return), add:

```typescript
// T63h: fingerprintPartState p95 < 5ms (synchronous djb2 of featureTree+parameters).
// Uses a synthetic 20-feature part document.
const _syntheticPart: import('@zilventor/shared').PartDocument = {
  id: 'perf-fp-part', name: 'FP Perf', units: 'mm',
  parameters: Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`p${i}`, { name: `p${i}`, value: i * 5, unit: 'mm' as const }])
  ) as Record<string, import('@zilventor/shared').SketchParameter>,
  featureTree: Array.from({ length: 20 }, (_, i) => ({
    id: `feat-${i}`, kind: 'extrude' as const,
    sketchId: `sk-${i}`, distance: { kind: 'literal' as const, value: 10 + i },
    operation: 'new' as const, symmetric: false,
  })) as import('@zilventor/shared').Feature[],
  properties: {}, materials: [], hardware: [],
};

w.__zilventorFingerprintPartStateMs = (n: number): number => {
  const { fingerprintPartState: fpFn } = require('./drawing/fingerprintPartState') as
    typeof import('./drawing/fingerprintPartState');
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fpFn(_syntheticPart);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.95)] ?? 0;
};
```

Also add cleanup:
```typescript
delete w.__zilventorFingerprintPartStateMs;
```

**Add unit test to `packages/app/src/__tests__/perfProbe.spec.ts`** (inside the existing `describe` or as a new `describe`):

```typescript
describe('__zilventorFingerprintPartStateMs (T63h)', () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as { __zilventorFingerprintPartStateMs?: unknown }).__zilventorFingerprintPartStateMs;
  });

  it('probe is registered and returns p95 < 5ms for 20-feature synthetic part', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));
    const probe = (globalThis as {
      __zilventorFingerprintPartStateMs?: (n: number) => number;
    }).__zilventorFingerprintPartStateMs;
    expect(typeof probe).toBe('function');
    const p95 = probe!(30);
    expect(p95).toBeGreaterThanOrEqual(0);
    expect(p95).toBeLessThan(5);
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/__tests__/perfProbe.spec.ts`
Expected GREEN.

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `feat(projection-pipeline): T63h perf probe — fingerprintPartState p95 < 5ms`

---

## Batch 6 — Real-geometry Playwright e2e + projection round-trip perf check

### Task 6.1 — T-6-17 real-geometry placement e2e

**No-TDD note:** Playwright e2e is by nature RED-then-GREEN but the "RED" is the absence of the test file (not a failing assertion). Write test, confirm it fails because the features don't work yet (they do by now, but the test provides the final verification gate).

Create `tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts`:

```typescript
// tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts
/**
 * T-6-17 — Drawing view projection pipeline: real-geometry placement + regenerate + staleness.
 *
 * Scope: base / projected / iso views.
 * Does NOT hand-type projection data — asserts kernel-derived edges.
 *
 * Steps:
 *   1. Build a real 50×50×30 box part via the UI (same as T-6-7).
 *   2. Re-execute in kernel to warm namedShapeCache.
 *   3. Drive CreateDrawingCommand to create a drawing sourced from that part; B0.3 sets activeDrawingSourcePartId.
 *   4. Activate placeBase mode → click sheet → assert view renders real edges (visibleEdges.length > 0).
 *   5. Activate placeIso mode → click sheet → assert iso view renders real edges.
 *   6. Simulate a source edit (clear inputFingerprint on base view) → remount → assert stale marker.
 *   7. Click Regenerate → assert stale marker cleared and edges updated.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-17: real-geometry projection pipeline — base + iso placement + stale + regen', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build a real box part in the kernel.
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // 2. Re-execute to ensure namedShapeCache is warm; capture partId.
  //    In the real app, CreateDrawingCommand.apply() (B0.3) calls loadDrawingSource
  //    which does opfs.read(partPath) → kernel.loadFromBytes → kernel.execute and sets
  //    BOTH activeDrawingSourcePartId AND activeDrawingSourceFingerprint (bytes hash).
  //    In this e2e, source.partPath = `${partId}.zipt` triggers the OPFS-fail fallback:
  //    partId returned directly, fingerprint = djb2(partId) (synthetic; acceptable for e2e).
  const { partId, sheetId, drawingId } = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; featureTree: unknown[]; parameters: Record<string, unknown> } | null;
          activeDrawingSourcePartId: string | null;
          activeDrawingSourceFingerprint: string | null;
          kernel: { execute(id: string): Promise<unknown>; getProjectorInput(args: { kind: 'part'; partId: string }): Promise<unknown> } | null;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || !s.kernel) throw new Error('T-6-17: kernel or activePart not ready');

    // Warm the kernel cache for the current active part
    await s.kernel.execute(s.activePart.id);

    const partId = s.activePart.id;
    const sheetId = `sheet-T617-${Date.now()}`;
    const drawingId = `drawing-T617-${Date.now()}`;

    const drawing = {
      id: drawingId, name: 'T-6-17 Drawing', units: 'mm',
      // source.partPath = `${partId}.zipt` — loadDrawingSource B0 fallback pattern:
      // OPFS read will fail (no real file), but activePartId matches the stem,
      // so the loader returns { partId, sourceFingerprint: djb2(partId) } directly.
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    // Drive CreateDrawingCommand — this sets activeDrawing AND (via B0.3 loadDrawingSource
    // fallback) sets BOTH activeDrawingSourcePartId AND activeDrawingSourceFingerprint.
    // Drawing commands are NOT window-exposed — use dynamic import.
    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    const cmd = new CreateDrawingCommand({
      sourcePath: `${partId}.zipt`,
      sourceKind: 'part',
    });
    await cmd.apply();

    // Verify BOTH source slots were set by B0.3
    const afterApply = w.__zilventorStore.getState();
    if (!afterApply.activeDrawingSourcePartId) {
      throw new Error(`T-6-17: activeDrawingSourcePartId is null after CreateDrawingCommand — B0 not wired`);
    }
    if (!afterApply.activeDrawingSourceFingerprint) {
      throw new Error(`T-6-17: activeDrawingSourceFingerprint is null after CreateDrawingCommand — B0 bytes-hash not wired`);
    }

    // Patch in the specific sheetId/drawingId used by subsequent steps
    // (CreateDrawingCommand generated its own ids; re-read them)
    const activeDoc = (afterApply as unknown as { activeDocument: { document: { id: string; sheets: Array<{ id: string }> } } }).activeDocument;
    return {
      partId,
      sheetId: activeDoc.document.sheets[0]!.id,
      drawingId: activeDoc.document.id,
    };
  });

  // 3. Switch to drawing tab (CreateDrawingCommand already activated the drawing).
  await page.getByRole('tab', { name: 'Drawing' }).click();
  // The sheet is empty initially — just the sheet border should be visible.
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });

  // 4. Place a base view via AddBaseViewCommand (simulating placeBase flow).
  //    In this test we drive the command directly (not through the full dialog + click UI)
  //    because Playwright click coordinates in an SVG are device-pixel-dependent.
  const baseViewId = await page.evaluate(
    async ({ sheetId }: { sheetId: string }) => {
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      const cmd = new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      });
      try {
        await cmd.apply();
      } catch (e) {
        throw new Error(`AddBaseViewCommand failed: ${String(e)}`);
      }
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> } } | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.kind === 'base');
      if (!baseView) throw new Error('T-6-17: base view not found after AddBaseViewCommand');
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error(`T-6-17: base view has no real projected edges. projection=${JSON.stringify(baseView.projection)}`);
      }
      return baseView.id;
    },
    { sheetId },
  );

  // 5. Assert the base view renders in the drawing canvas with real geometry.
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  // The rendered SVG contains at least one <path> element (each visibleEdge becomes a path).
  const edgeCount = await page.locator(`g[data-view-id="${baseViewId}"] path`).count();
  expect(edgeCount).toBeGreaterThan(0);

  // 6. Place an iso view via AddIsoViewCommand.
  const isoViewId = await page.evaluate(
    async ({ sheetId }: { sheetId: string }) => {
      const { AddIsoViewCommand } = await import('/src/commands/AddIsoViewCommand.ts');
      const cmd = new AddIsoViewCommand({
        sheetId,
        positionMm: { x: 250, y: 80 },
        corner: 'NE',
        scale: { numerator: 1, denominator: 1 },
      });
      await cmd.apply();
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> } } | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const isoView = sheet?.views.find((v) => v.kind === 'iso');
      if (!isoView?.projection || isoView.projection.visibleEdges.length === 0) {
        throw new Error(`T-6-17: iso view has no real projected edges`);
      }
      return isoView.id;
    },
    { sheetId },
  );

  await expect(page.locator(`g[data-view-id="${isoViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 7. Simulate staleness (condition b): set activeDrawingSourceFingerprint to a NEW value
  //    (simulating a source edit between the view being placed and the current activation).
  //    The view's stored inputFingerprint still holds the OLD value → mismatch → stale.
  //    This tests the correct staleness condition — the one the original plan BROKE by using
  //    djb2(kernelId) which never changes. Here we change the fingerprint to simulate a real edit.
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { id: string; name: string; units: string; source: unknown; properties: unknown; sheets: Array<{ id: string; name: string; size: unknown; orientation: string; views: Array<{ id: string; [key: string]: unknown }>; dimensions: unknown[]; dimensionGroups: unknown[]; annotations: unknown[]; titleBlock: unknown }>; activeSheetId: string } } | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceFingerprint: string | null;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!doc) return;
      // Read the base view's current inputFingerprint (set when it was projected)
      const sheet = doc.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.id === baseViewId);
      const oldFp = (baseView as { inputFingerprint?: string } | undefined)?.inputFingerprint;
      if (!oldFp) {
        // Fallback: clear inputFingerprint to trigger condition (a)
        const next = {
          ...doc,
          sheets: doc.sheets.map((sh) =>
            sh.id === sheetId
              ? { ...sh, views: sh.views.map((v) => v.id === baseViewId ? (({ inputFingerprint: _fp, ...rest }) => rest)(v as { inputFingerprint?: string; [key: string]: unknown }) : v) }
              : sh
          ),
        };
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: next },
          activeDrawing: next,
          activeDrawingSourcePartId: s.activeDrawingSourcePartId,
          activeDrawingSourceFingerprint: s.activeDrawingSourceFingerprint,
          activePart: null,
          activeAssembly: null,
        });
      } else {
        // Primary path (condition b): change activeDrawingSourceFingerprint to simulate
        // a source edit after the view was projected.
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: doc },
          activeDrawing: doc,
          activeDrawingSourcePartId: s.activeDrawingSourcePartId,
          activeDrawingSourceFingerprint: oldFp + '-EDITED', // different from view's inputFingerprint
          activePart: null,
          activeAssembly: null,
        });
      }
    },
    { sheetId, baseViewId },
  );

  // Switch away and back to trigger the stale detection useEffect.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // 8. Assert stale marker visible on the base view.
  await expect(page.locator('[data-stale-marker]')).toBeVisible({ timeout: 10_000 });

  // 9. Click Regenerate — the handleRegenerate now calls projectViewFromSource.
  await page.locator('[data-stale-marker]').click();

  // 10. Assert stale marker cleared.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 10_000 });
});
```

Run: `pnpm --filter app exec playwright test tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts`
Expected GREEN (after all B1–B5 changes are in place).

**Commit:** `test(projection-pipeline): T-6-17 real-geometry Playwright e2e — base + iso + stale + regen`

---

### Task 6.2 — Projection round-trip perf probe (T63i)

**No-TDD note:** follows existing T62/T63 perf probe pattern from `App.tsx`. The probe measures `getProjectorInput` (kernel RPC) + `projectView` (pure JS) round-trip using a mocked synthetic input.

**Edit `packages/app/src/App.tsx`** — inside the perf hooks `useEffect`, add after the `__zilventorFingerprintPartStateMs` probe:

```typescript
// T63i: getProjectorInput + projectView round-trip p95 < 2000ms.
// NOTE: This is a pure-JS benchmark using synthetic ProjectorInput data — it does NOT
// call the real kernel worker. The kernel RPC cost is excluded (it runs off-thread via
// Comlink and varies with WASM load). The 2000ms budget is for the pure projectView
// computation only; real kernel RPC adds variable latency.
w.__zilventorProjectionRoundTripMs = (n: number): number => {
  const { projectView: pvFn } = require('@zilventor/shared/src/drawing/projector') as
    typeof import('@zilventor/shared/src/drawing/projector');
  const synthInput: import('@zilventor/shared').ProjectorInput = {
    triangles: Array.from({ length: 100 }, (_, i) => {
      const bx = (i % 10) * 10; const bz = Math.floor(i / 10) * 10;
      return [[bx, 0, bz], [bx + 8, 0, bz], [bx + 4, 8, bz + 8]] as
        [[number,number,number],[number,number,number],[number,number,number]];
    }),
    edges: Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      points: [[(i % 10) * 10, 0, 0], [(i % 10) * 10 + 8, 0, 0]] as [[number,number,number],[number,number,number]],
      adjacentFaces: [],
    })),
    bbox: [0, 0, 0, 100, 10, 100] as [number,number,number,number,number,number],
  };
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    pvFn(synthInput, 'front');
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.95)] ?? 0;
};
```

Add cleanup: `delete w.__zilventorProjectionRoundTripMs;`

**Add unit test to `packages/app/src/__tests__/perfProbe.spec.ts`**:

```typescript
describe('__zilventorProjectionRoundTripMs (T63i)', () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as { __zilventorProjectionRoundTripMs?: unknown }).__zilventorProjectionRoundTripMs;
  });

  it('pure projectView on 100-triangle fixture p95 < 200ms', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));
    const probe = (globalThis as {
      __zilventorProjectionRoundTripMs?: (n: number) => number;
    }).__zilventorProjectionRoundTripMs;
    expect(typeof probe).toBe('function');
    const p95 = probe!(30);
    expect(p95).toBeGreaterThanOrEqual(0);
    expect(p95).toBeLessThan(200); // pure JS only; no kernel RPC in this probe
  });
});
```

Run: `pnpm --filter app test:unit -- --run src/__tests__/perfProbe.spec.ts`
Expected GREEN.

Run full suite: `pnpm --filter app test:unit`
Expected GREEN.

**Commit:** `test(projection-pipeline): T63i perf probe — projectView round-trip p95 < 200ms (pure JS)`

---

## Self-Review (writing-plans checklist)

### Spec coverage
- [x] Source-geometry loading on drawing activation → B0 Tasks 0.1 + 0.2 + 0.3
- [x] `source.partPath` semantics resolved → B0 Task 0.2 (OPFS filename; `${partId}.zipt` test fallback documented)
- [x] New `activeDrawingSourcePartId` store slot → B0 Task 0.1
- [x] New `activeDrawingSourceFingerprint` store slot (THE FLAW FIX) → B0 Task 0.1
- [x] `loadDrawingSource` returns `{ partId, sourceFingerprint }` with bytes-hash fingerprint → B0 Task 0.2
- [x] `CreateDrawingCommand` sets BOTH source slots from `loadDrawingSource` → B0 Task 0.3
- [x] `drawingDocState` resets BOTH source slots to null → B0 Task 0.1 Step 3
- [x] `projectViewFromSource` reads `activeDrawingSourceFingerprint` as `inputFingerprint` (not `djb2(kernelId)`) → B1 Task 1.2
- [x] `getProjectorInput` null return handled as `GEOMETRY_NOT_CACHED` (not throw) → B1 Task 1.2
- [x] Base view placement → B1 Task 1.3 + 1.4
- [x] Projected view placement → B2 Tasks 2.1 + 2.2 + B1 Task 1.4 (wiring)
- [x] Iso view placement → B3 Task 3.1 + B1 Task 1.4 (wiring)
- [x] Regenerate → B4 Task 4.1
- [x] Staleness reads `activeDrawingSourceFingerprint` (not `fingerprintPartState(source)`) → B5 Task 5.1
- [x] `computeStaleViewIds` extracted as pure function for testability → B5 Task 5.1
- [x] B5 RED test asserts staleness FIRES on source-content change (fingerprint diverges) → B5 Task 5.1
- [x] Real-geometry e2e drives CreateDrawingCommand → B6 Task 6.1
- [x] Perf check → B6 Task 6.2

### Placeholder scan
None found. All code blocks are complete.

### Type consistency
- `activeDrawingSourcePartId: string | null` added to `AppState` and initialized in the store. ✓
- `activeDrawingSourceFingerprint: string | null` added to `AppState` and initialized in the store. ✓
- `drawingDocState()` return type includes BOTH `activeDrawingSourcePartId: null` and `activeDrawingSourceFingerprint: null`. ✓
- `loadDrawingSource` returns `Promise<LoadDrawingSourceResult>` = `Promise<{ partId: string; sourceFingerprint: string }>`. ✓
- `CreateDrawingCommand` sets both slots from `loadDrawingSource` result; revert restores both. ✓
- `projectViewFromSource` reads `activeDrawingSourceFingerprint` as `inputFingerprint` (live-app path), falls back to `fingerprintPartState(activePart)` (test-fallback path). ✓
- `getProjectorInput` return: `Promise<ProjectorInput | null>` — null handled, not expected to throw. ✓ (confirmed at `packages/kernel/src/api.ts:93`)
- `KernelForLoad.execute` return: `Promise<{ ok: boolean; value?: unknown; error?: unknown }>` — matches `Result<ExecuteResult, KernelError>` minimal shape. ✓
- `ViewOrientation` imported from `@zilventor/shared/src/drawing/viewMatrix` throughout. ✓
- `ProjectedGeometry` imported from `@zilventor/shared/src/drawing/projectedGeometry`. ✓
- `PartDocument`, `DrawingDocument`, `BaseView`, `ProjectedView`, `IsoView` from `@zilventor/shared`. ✓
- `fingerprintPartState` returns `string` (djb2 8-char hex). ✓
- `deriveProjectedOrientation` returns `ViewOrientation`. ✓
- `computeStaleViewIds(views, fingerprint)` returns `Set<string>`. ✓

### Verified facts vs. brief (corrections)
1. `source.partPath` is an **OPFS filename** (e.g. `"cabinet1.zipt"`) — NOT a kernel UUID. Tests use `"${partId}.zipt"` as a synthetic value. `loadDrawingSource` fallback handles both.
2. `drawingDocState()` sets `activePart: null` — confirmed from `packages/app/src/store/drawingDocState.ts:12`. B0 adds BOTH new slots to the returned object.
3. `projectViewFromSource` original plan read `state.activePart?.id` for partId and `djb2(kernelId)` for fingerprint — WRONG in both cases for the live app. Fixed to use `activeDrawingSourcePartId` (partId) and `activeDrawingSourceFingerprint` (bytes hash) first, with `activePart` fallback for unit tests.
4. `getProjectorInput` returns `Promise<ProjectorInput | null>` — NOT throws on cache miss. Confirmed at `packages/kernel/src/api.ts:93`. The original plan's "THROWS" claim was wrong. Fixed: check for null → throw `GEOMETRY_NOT_CACHED`.
5. `kernel.execute()` returns `Promise<Result<ExecuteResult, KernelError>>` — `{ ok: true; value: ExecuteResult } | { ok: false; error: KernelError }`. `KernelForLoad` type updated to match.
6. Drawing creation is done via `CreateDrawingCommand` dispatched from `NewDrawingDialog.handleOk()`. Drawing file-reopen is a `TODO Sub-project 6` at `FileTab.tsx:95` — out of scope.
7. `Opfs.forNavigator()` requires browser context — `if (kernel)` guard in `CreateDrawingCommand.apply()` skips it in unit tests (kernel = null). `vi.mock('../../drawing/loadDrawingSource')` in the spec prevents the real Opfs call entirely.
8. The `djb2` function is NOT exported from `packages/shared/src/drawing/fingerprint.ts`. Each file that needs it defines it inline (consistent with existing `planeFingerprint.ts`, `fingerprintPartState.ts` pattern).

---

## Confidence: 87

The plan is grounded in verified source code. All key signatures confirmed by reading actual files. The flaw fix (bytes-hash fingerprint instead of djb2(kernelId)) is mechanically sound: bytes change on every part save, djb2(bytes) changes, staleness fires. The pure `computeStaleViewIds` extraction makes the staleness logic TDD-testable without React. Residual risks:

1. `Opfs.forNavigator()` inside `CreateDrawingCommand.apply()` — browser-only. Mitigated by `if (kernel)` guard + `vi.mock` in spec. Must keep the mock in place.
2. `loadDrawingSource` module-level cache: `vi.resetModules()` + dynamic re-import clears it between tests. Implementer must follow this pattern. `_clearLoadDrawingSourceCache()` exported for explicit reset.
3. `handleRegenerate` for projected views requires finding the base view — if it was removed by undo, silently falls through. Acceptable for this pass.
4. The perfProbe for `__zilventorFingerprintPartStateMs` uses `require()` inside an effect — use static import instead.
5. Assembly-sourced drawings get `activeDrawingSourcePartId = null` and will throw `PART_NOT_IN_STORE`. Out of scope, documented.
