# Drawing-Export Source Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four drawing-export buttons (PDF/SVG/PNG/DXF) clickable when a drawing is the active document, by stashing the already-loaded source document in a new `activeDrawingSourceDocument` store slot at activation time.

**Architecture:** Additive store slot holding the resolved `PartDocument | AssemblyDocument`, populated wherever a drawing's source loads (`CreateDrawingCommand`, `activateDrawingDocument`). `DrawingTab` falls back to it when `activePart`/`activeAssembly` are null. Read-only — no manifest bump (stays v19). Export commands need `source` only for title-block metadata (`name` + `materials[0]`) and the `'featureTree' in source` part/assembly discriminator; all geometry is already baked into `drawing.sheets`.

**Tech Stack:** TypeScript, Zustand store, Vitest unit tests, Playwright e2e (root config, `--project=chromium`).

**Spec:** `docs/superpowers/specs/2026-05-27-drawing-export-source-design.md`

**Decisions locked (brainstorming):** Q1 store-slot-at-activation · Q2 part+assembly parity · Q3 keep buttons disabled when source genuinely fails to load.

**Gate commands:**
- Unit (single file): `pnpm --filter app exec vitest run <path>`
- Unit (full app suite): `pnpm --filter app test:unit`
- Full repo gate: `pnpm -r test:unit` (expect 2893 → grows)
- E2E: `pnpm test:e2e -- tests/e2e/drawing/<spec> --project=chromium` (run from REPO ROOT)
- Typecheck: `pnpm -r typecheck`
- Lint: `pnpm lint` (run inside the worktree or after cleanup — root lint does NOT ignore `.worktrees/`)

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/app/src/drawing/loadDrawingSource.ts` | Load source part into kernel + fingerprint | **Modify** — also unpack & return `sourceDocument: PartDocument \| null` |
| `packages/app/src/store/useAppStore.ts` | Zustand store | **Modify** — add `activeDrawingSourceDocument` slot (interface + init) |
| `packages/app/src/store/drawingDocState.ts` | "drawing active" derived slice | **Modify** — doc-comment only (new slot auto-preserved) |
| `packages/app/src/commands/CreateDrawingCommand.ts` | Create-drawing command | **Modify** — set slot (part+assembly) + revert |
| `packages/app/src/drawing/activateDrawingDocument.ts` | Reopen/activate routine | **Modify** — set slot (part+assembly) + null on failure |
| `packages/app/src/shell/tabs/DrawingTab.tsx` | Drawing ribbon tab + export buttons | **Modify** — `source` selector adds the new slot |
| `tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts` | Real-env regression gate | **Create** |

Test files (all exist; extend them):
- `packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts`
- `packages/app/src/store/__tests__/drawingDocState.spec.ts`
- `packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`
- `packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts`
- `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`

---

## Task 1: `loadDrawingSource` returns the unpacked `sourceDocument`

**Files:**
- Modify: `packages/app/src/drawing/loadDrawingSource.ts`
- Test: `packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts`

Context: the real path already reads the source `.zipt` bytes (line 84) before `kernel.loadFromBytes`. We additionally unpack the manifest envelope and return its `.document`. `unpackProject(bytes).manifest` is the `{ formatVersion, kind, createdAt, appVersion, document }` envelope (see `ProjectPacker.ts:29`, `resolvePartInfo.ts:13`). The fallback (test-fixture) path has no bytes → returns `null`.

- [ ] **Step 1: Write the failing test**

Add to `loadDrawingSource.spec.ts`. The existing spec already stubs `opfs`/`kernel`; mirror its style. Add a helper that packs a real part archive so the real path can unpack it:

```ts
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';

it('real path returns sourceDocument unpacked from the source bytes', async () => {
  _clearLoadDrawingSourceCache();
  const partDoc = {
    id: 'part-1', name: 'Widget', units: 'mm',
    parameters: {}, featureTree: [], properties: {},
    materials: [{ id: 'm1', name: 'Plywood 18mm', defaultThickness: 18, color: '#c8a96e' }], hardware: [],
  };
  const bytes = await packProject({
    manifest: { formatVersion: 19, kind: 'part', createdAt: '2026-01-01', appVersion: 'test', document: partDoc },
    blobs: {},
  });
  const kernel = { loadFromBytes: async () => 'kid-1', execute: async () => ({ ok: true }) };
  const opfs = { exists: async () => true, read: async () => bytes };

  const res = await loadDrawingSource({ partPath: 'parts/widget.zipt', kernel, opfs });

  expect(res.sourceDocument?.name).toBe('Widget');
  expect(res.sourceDocument?.materials?.[0]?.name).toBe('Plywood 18mm');
});

it('fallback (no OPFS bytes) returns sourceDocument null', async () => {
  _clearLoadDrawingSourceCache();
  const kernel = { loadFromBytes: async () => 'kid-x', execute: async () => ({ ok: true }) };
  const opfs = { exists: async () => false, read: async () => { throw new Error('ENOENT'); } };

  const res = await loadDrawingSource({ partPath: 'kid-x.zipt', kernel, opfs, activePartId: 'kid-x' });

  expect(res.partId).toBe('kid-x');
  expect(res.sourceDocument).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts`
Expected: FAIL — `res.sourceDocument` is `undefined` (property does not exist yet).

- [ ] **Step 3: Implement**

In `loadDrawingSource.ts`:

Add imports at top:
```ts
import type { PartDocument } from '@zilventor/shared';
import { migrateManifest } from '@zilventor/shared';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
```

Extend the result type:
```ts
export type LoadDrawingSourceResult = {
  partId: string;
  sourceFingerprint: string;
  /** The unpacked source PartDocument (real path) or null (fallback test path).
   *  Used by DrawingTab to enable export buttons + by resolveTitleBlock for metadata. */
  sourceDocument: PartDocument | null;
};
```

In the REAL path (inside the `try`, after `const bytes = await opfs.read(partPath);`):
```ts
const sourceFingerprint = djb2Bytes(bytes);
const partId = await kernel.loadFromBytes(bytes);
const res = await kernel.execute(partId);
if (!res.ok) {
  throw new Error(`kernel.execute failed: ${String((res as { error?: unknown }).error)}`);
}
// Unpack the manifest envelope so DrawingTab/title-block have the source document.
// Geometry is unused here (already loaded into the kernel above); we only need name+materials.
let sourceDocument: PartDocument | null = null;
try {
  const { manifest } = await unpackProject(bytes);
  const migrated = migrateManifest(manifest as Parameters<typeof migrateManifest>[0]);
  sourceDocument = (migrated as { document?: PartDocument }).document ?? null;
} catch {
  sourceDocument = null; // malformed manifest → button stays disabled; non-fatal
}
const result: LoadDrawingSourceResult = { partId, sourceFingerprint, sourceDocument };
cache.set(partPath, result);
return result;
```

In the FALLBACK path, add `sourceDocument: null`:
```ts
const result: LoadDrawingSourceResult = {
  partId: activePartId,
  sourceFingerprint: djb2Str(activePartId),
  sourceDocument: null,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/loadDrawingSource.ts packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts
git commit -m "feat(drawing-export): loadDrawingSource returns unpacked sourceDocument"
```

---

## Task 2: Add `activeDrawingSourceDocument` store slot + preservation guard

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (interface ~line 103-117, init ~line 353-355)
- Modify: `packages/app/src/store/drawingDocState.ts` (doc-comment only)
- Test: `packages/app/src/store/__tests__/drawingDocState.spec.ts`

Note: `drawingDocState()` returns an object that sets `activePart/activeAssembly/activeDrawing/activeDocument` only — it does NOT enumerate source slots, so the new slot is preserved automatically. The guard test locks that contract.

- [ ] **Step 1: Write the failing test**

Add to `drawingDocState.spec.ts`:
```ts
it('preserves activeDrawingSourceDocument across a drawingDocState write', () => {
  const stubDoc = { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
    featureTree: [], properties: {}, materials: [], hardware: [] };
  useAppStore.setState({ activeDrawingSourceDocument: stubDoc } as never);

  const nextDrawing = { ...someDrawingDoc }; // reuse the spec's existing drawing fixture
  useAppStore.setState(drawingDocState(nextDrawing));

  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
    .activeDrawingSourceDocument).toBe(stubDoc);
});
```
(Use whatever drawing fixture the existing `drawingDocState.spec.ts` already builds.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run packages/app/src/store/__tests__/drawingDocState.spec.ts`
Expected: FAIL — `activeDrawingSourceDocument` is `undefined` (slot not declared on the store yet).

- [ ] **Step 3: Implement**

In `useAppStore.ts`, after the `activeDrawingSourceComponents` interface declaration (line ~117) add:
```ts
/** The resolved source document (PartDocument | AssemblyDocument) for the active
 *  drawing. Used by DrawingTab's export buttons for title-block metadata + the
 *  'featureTree' in source part/assembly discriminator. Set wherever a drawing's
 *  source loads (CreateDrawingCommand, activateDrawingDocument). NOT reset by
 *  drawingDocState() / setActiveDocument — same lifecycle contract as
 *  activeDrawingSourcePartId. Null when no source is loaded → export buttons
 *  correctly stay disabled. */
activeDrawingSourceDocument: PartDocument | AssemblyDocument | null;
```
(`PartDocument`/`AssemblyDocument` are already imported in `useAppStore.ts` for `activePart`/`activeAssembly`; reuse the existing import. If only one is imported, add the other to that same import line.)

In the initial-state object, after `activeDrawingSourceComponents: null,` (line ~355) add:
```ts
activeDrawingSourceDocument: null,
```

In `drawingDocState.ts`, extend the existing doc-comment line:
```
 * Does NOT reset activeDrawingSourcePartId / activeDrawingSourceFingerprint /
 * activeDrawingSourceComponents / activeDrawingSourceDocument — those are set by
 * CreateDrawingCommand → loadDrawingSource ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run packages/app/src/store/__tests__/drawingDocState.spec.ts`
Expected: PASS.

- [ ] **Step 4b: Red-check the guard has teeth** (TDD-hygiene — this test is green-from-start)

Temporarily add `activeDrawingSourceDocument: null,` to the object returned by `drawingDocState()`. Re-run the test → it must FAIL (slot wiped). Then REVERT that line. Quote the RED in the commit/PR notes.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/drawingDocState.ts packages/app/src/store/__tests__/drawingDocState.spec.ts
git commit -m "feat(drawing-export): add activeDrawingSourceDocument store slot + preservation guard"
```

---

## Task 3: `CreateDrawingCommand` sets + reverts the slot (part + assembly)

**Files:**
- Modify: `packages/app/src/commands/CreateDrawingCommand.ts`
- Test: `packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `CreateDrawingCommand.spec.ts` (mirror the existing setup that seeds `activePart`/`activeAssembly` + mocks `loadDrawingSource`):
```ts
it('part: sets activeDrawingSourceDocument from the captured activePart', async () => {
  const partDoc = { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
    featureTree: [], properties: {}, materials: [], hardware: [] };
  useAppStore.setState({ activePart: partDoc, activeAssembly: null } as never);

  await new CreateDrawingCommand({ sourcePath: 'p1.zipt', sourceKind: 'part' }).apply();

  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
    .activeDrawingSourceDocument).toMatchObject({ id: 'p1', name: 'Widget' });
});

it('assembly: sets activeDrawingSourceDocument from the captured activeAssembly', async () => {
  const asmDoc = { id: 'a1', name: 'Cabinet', units: 'mm', parameters: {}, components: [],
    constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] };
  useAppStore.setState({ activePart: null, activeAssembly: asmDoc } as never);

  await new CreateDrawingCommand({ sourcePath: 'a1.ziasm', sourceKind: 'assembly' }).apply();

  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
    .activeDrawingSourceDocument).toMatchObject({ id: 'a1', name: 'Cabinet' });
});

it('revert restores the prior activeDrawingSourceDocument', async () => {
  const prior = { id: 'prev', name: 'Prev', units: 'mm', parameters: {},
    featureTree: [], properties: {}, materials: [], hardware: [] };
  const partDoc = { ...prior, id: 'p1', name: 'Widget' };
  useAppStore.setState({ activeDrawingSourceDocument: prior, activePart: partDoc } as never);

  const cmd = new CreateDrawingCommand({ sourcePath: 'p1.zipt', sourceKind: 'part' });
  await cmd.apply();
  await cmd.revert();

  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
    .activeDrawingSourceDocument).toBe(prior);
});
```
Adjust mocks so `loadDrawingSource` returns `{ partId, sourceFingerprint, sourceDocument: null }` (the `?? activePartDoc` fallback is what these part tests exercise). If the existing spec mocks `loadDrawingSource` via `vi.mock`, add `sourceDocument: null` to the mocked return.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`
Expected: FAIL — slot is `undefined`/unset after apply; revert assertion fails.

- [ ] **Step 3: Implement**

In `CreateDrawingCommand.ts`:

Add type import if missing:
```ts
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';
```

Add a private field (near line 12):
```ts
private prevActiveDrawingSourceDocument: PartDocument | AssemblyDocument | null = null;
```

Extend `prevSlots` cast (line 27-31) to include the new slot and snapshot it:
```ts
const prevSlots = state as unknown as {
  activeDrawingSourcePartId: string | null;
  activeDrawingSourceFingerprint: string | null;
  activeDrawingSourceComponents: AssemblyComponentInput[] | null;
  activeDrawingSourceDocument: PartDocument | AssemblyDocument | null;
};
this.prevActiveDrawingSourcePartId = prevSlots.activeDrawingSourcePartId;
this.prevActiveDrawingSourceFingerprint = prevSlots.activeDrawingSourceFingerprint;
this.prevActiveDrawingSourceComponents = prevSlots.activeDrawingSourceComponents;
this.prevActiveDrawingSourceDocument = prevSlots.activeDrawingSourceDocument;
```

Capture the active part doc before `setActiveDocument` (next to the existing `activePartId` / `activeAsmDoc` captures, lines 37-39):
```ts
const activePartDoc = state.activePart;
```

In the PART branch `setState` (lines 92-95), add the slot using the loaded doc with the captured-part fallback:
```ts
useAppStore.setState({
  activeDrawingSourcePartId: partId,
  activeDrawingSourceFingerprint: sourceFingerprint,
  activeDrawingSourceDocument: sourceDocument ?? activePartDoc,
} as never);
```
(Destructure `sourceDocument` from the `loadDrawingSource` result: `const { partId, sourceFingerprint, sourceDocument } = await loadDrawingSource({...});`)

In the ASSEMBLY branch `setState` (lines 117-120), add:
```ts
useAppStore.setState({
  activeDrawingSourceComponents: components,
  activeDrawingSourceFingerprint: sourceFingerprint,
  activeDrawingSourceDocument: activeAsmDoc,
} as never);
```

In `revert()` (lines 138-142), add the slot to the restore `setState`:
```ts
useAppStore.setState({
  activeDrawingSourcePartId: this.prevActiveDrawingSourcePartId,
  activeDrawingSourceFingerprint: this.prevActiveDrawingSourceFingerprint,
  activeDrawingSourceComponents: this.prevActiveDrawingSourceComponents,
  activeDrawingSourceDocument: this.prevActiveDrawingSourceDocument,
} as never);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter app exec vitest run packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/CreateDrawingCommand.ts packages/app/src/commands/__tests__/CreateDrawingCommand.spec.ts
git commit -m "feat(drawing-export): CreateDrawingCommand sets+reverts activeDrawingSourceDocument"
```

---

## Task 4: `activateDrawingDocument` sets the slot (part + assembly reopen) + nulls on failure

**Files:**
- Modify: `packages/app/src/drawing/activateDrawingDocument.ts`
- Test: `packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `activateDrawingDocument.spec.ts` (mirror existing mock injection of `kernel`/`opfs` + `loadDrawingSource`):
```ts
it('part reopen: sets activeDrawingSourceDocument from loadDrawingSource', async () => {
  // arrange a part-sourced DrawingDocument fixture + mock loadDrawingSource to return
  // { partId:'kid', sourceFingerprint:'fp', sourceDocument:{ id:'p1', name:'Widget', ... } }
  await activateDrawingDocument(partDrawingDoc, { kernel, opfs });
  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: { name?: string } | null })
    .activeDrawingSourceDocument?.name).toBe('Widget');
});

it('assembly reopen: sets activeDrawingSourceDocument from the unpacked asmDoc', async () => {
  // mock unpackAssembly → asmDoc { id:'a1', name:'Cabinet', ... }, loadAssemblyForProjection → {components,fp}
  await activateDrawingDocument(asmDrawingDoc, { kernel, opfs });
  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: { name?: string } | null })
    .activeDrawingSourceDocument?.name).toBe('Cabinet');
});

it('source load failure nulls activeDrawingSourceDocument', async () => {
  useAppStore.setState({ activeDrawingSourceDocument: { id: 'stale', name: 'Stale' } } as never);
  // mock loadDrawingSource to throw
  await activateDrawingDocument(partDrawingDoc, { kernel, opfs: failingOpfs });
  expect((useAppStore.getState() as never as { activeDrawingSourceDocument: unknown })
    .activeDrawingSourceDocument).toBeNull();
});
```
**Adapt to the existing harness (verified):** this spec has NO `partDrawingDoc`/`asmDrawingDoc` named fixtures — it uses `baseDoc` (a part-sourced `DrawingDocument`) and builds the assembly doc inline by spreading `baseDoc` with `source: { partPath: '…ziasm', sourceKind: 'assembly' }`. Reuse those. The assembly test must assert the name returned by the spec's existing `unpackAssembly` **mock** — currently `'Mock Assembly'`, NOT `'Cabinet'`. The part test must assert whatever `name` the spec's mocked `loadDrawingSource.sourceDocument` returns (add a `sourceDocument` with a known name to that mock).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts`
Expected: FAIL — slot stays unset / stale ('Stale' not nulled).

- [ ] **Step 3: Implement**

In `activateDrawingDocument.ts`:

ASSEMBLY success `setState` (lines 42-45) — add the already-unpacked `asmDoc`:
```ts
useAppStore.setState({
  activeDrawingSourceComponents: components,
  activeDrawingSourceFingerprint: sourceFingerprint,
  activeDrawingSourceDocument: asmDoc,
} as never);
```
ASSEMBLY catch (lines 52-56) — add `activeDrawingSourceDocument: null,`.

PART success `setState` (lines 74-77) — destructure `sourceDocument` and set it:
```ts
const { partId, sourceFingerprint, sourceDocument } = await loadDrawingSource({
  partPath: doc.source.partPath, kernel, opfs, activePartId,
});
useAppStore.setState({
  activeDrawingSourcePartId: partId,
  activeDrawingSourceFingerprint: sourceFingerprint,
  activeDrawingSourceDocument: sourceDocument,
} as never);
```
PART catch (lines 90-94) — add `activeDrawingSourceDocument: null,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter app exec vitest run packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/drawing/activateDrawingDocument.ts packages/app/src/drawing/__tests__/activateDrawingDocument.spec.ts
git commit -m "feat(drawing-export): activateDrawingDocument sets activeDrawingSourceDocument on reopen"
```

---

## Task 5: `DrawingTab` derives `source` including the new slot

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx:15`
- Test: `packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`

- [ ] **Step 1: Write the failing test**

Add to `DrawingTab.spec.tsx` (mirror the existing render harness — it already renders `DrawingTab` against the store and queries export buttons by `aria-label`):
```ts
it('enables export buttons from activeDrawingSourceDocument alone (drawing active, activePart null)', () => {
  // seed an active drawing document the same way the existing spec does, but with
  // activePart: null, activeAssembly: null, and activeDrawingSourceDocument set:
  useAppStore.setState({
    activePart: null,
    activeAssembly: null,
    activeDrawingSourceDocument: { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
      featureTree: [], properties: {}, materials: [], hardware: [] },
  } as never);

  render(<DrawingTab />); // match existing render call/wrappers in this spec

  for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
  }
});
```
(Confirm the exact button `aria-label`s in `DrawingTab.tsx`; the DXF one is `Export DXF`. Adjust the seeded active-drawing state to whatever the existing spec uses so the buttons render at all.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`
Expected: FAIL — buttons are `disabled` because `source = activePart ?? activeAssembly` is null today.

- [ ] **Step 3: Implement**

In `DrawingTab.tsx:15`:
```ts
const source = useAppStore((s) => s.activePart ?? s.activeAssembly ?? s.activeDrawingSourceDocument);
```
No other changes — `disabled={!source}` and the four handlers stay as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full app suite + typecheck**

Run: `pnpm --filter app test:unit && pnpm -r typecheck`
Expected: all green (no regression in the other DrawingTab specs — holeTable/autoDim/f5).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.spec.tsx
git commit -m "feat(drawing-export): DrawingTab falls back to activeDrawingSourceDocument for source"
```

---

## Task 6: Real-environment e2e — buttons enabled without a stub (part + assembly)

**Files:**
- Create: `tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts`

This is the actual gate. Template off `tests/e2e/drawing/T-6-22-dxf-export.spec.ts` but **DELETE its Step 8** (the `store.setState({ activePart: stubPart })` block at `T-6-22:349-378`). After the fix, `CreateDrawingCommand` sets `activeDrawingSourceDocument`, so the buttons enable with no stub — that absence IS the regression proof.

- [ ] **Step 1: Write the e2e — part variant**

Reuse T-6-22 steps 1–7 (create a real part in the kernel, save bytes, create a drawing via the real `CreateDrawingCommand`, place views). Then, WITHOUT injecting `activePart`:
```ts
// Assert all four export buttons are enabled with NO activePart stub.
for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
  await expect(page.getByRole('button', { name: label })).toBeEnabled();
}
// Sanity: prove the slot (not activePart) is what enabled them.
const slot = await page.evaluate(() =>
  (window as unknown as { __zilventorStore: { getState(): { activePart: unknown; activeDrawingSourceDocument: unknown } } })
    .__zilventorStore.getState());
// VERIFIED: the e2e store bridge is window.__zilventorStore (NOT window.useAppStore) —
// see T-6-22:356-363. Assert activePart === null AND activeDrawingSourceDocument is truthy.

// Then trigger one real export to confirm end-to-end:
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export DXF' }).click(),
]);
expect(await download.path()).toBeTruthy();
```

- [ ] **Step 2: Add the assembly variant**

In the same spec (or a second `test()` block), build an assembly-sourced drawing — template off `tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts` for the assembly setup (seed an `activeAssembly`, create the drawing with `sourceKind:'assembly'`). Assert the same four buttons are enabled with no stub.

- [ ] **Step 3: Run the e2e**

Run (from REPO ROOT): `pnpm test:e2e -- tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts --project=chromium`
Expected: PASS. Read the browser console output back — confirm no `source`/`PART_NOT_IN_STORE` errors.

- [ ] **Step 4: Verify it has teeth**

Temporarily revert the `DrawingTab.tsx:15` selector change (back to `activePart ?? activeAssembly`). Re-run the e2e → it must FAIL (buttons disabled). Restore the selector. Quote the RED.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts
git commit -m "test(drawing-export): T-6-23 e2e — export buttons enabled for drawings without a stub"
```

---

## Task 7: Final gate + branch finish

- [ ] **Step 1: Full repo gate**

Run: `pnpm -r test:unit`
Expected: 2893 + new app tests (loadDrawingSource +2, drawingDocState +1, CreateDrawingCommand +3, activateDrawingDocument +3, DrawingTab +1 = +10 app) all green.

- [ ] **Step 2: Typecheck + lint**

Run (inside the worktree): `pnpm -r typecheck && pnpm lint`
Expected: typecheck clean; lint 0 errors. (If a `.worktrees/` path appears in lint errors, ignore — run after worktree cleanup; root lint does not ignore `.worktrees/`.)

- [ ] **Step 3: E2E gate**

Run (from REPO ROOT): `pnpm test:e2e -- tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 4: Finish the branch** via `superpowers:finishing-a-development-branch` (FF merge to master + push + worktree remove/prune + branch -d + rewrite `next_session_resume.md` + write `project_drawing_export_source_feature.md` memory).

---

## Self-Review

**Spec coverage:**
- New store slot → Task 2. ✓
- `loadDrawingSource` returns `sourceDocument` → Task 1. ✓
- `CreateDrawingCommand` set+revert (part+assembly) → Task 3. ✓
- `activateDrawingDocument` set (part+assembly reopen) + null-on-failure → Task 4. ✓
- `DrawingTab` selector → Task 5. ✓
- `drawingDocState` no-reset guard + comment → Task 2. ✓
- Q3 (missing source → disabled) → Task 4 null-on-failure + Task 5 `disabled={!source}` unchanged. ✓
- Q2 (assembly parity) → Task 3 assembly branch + Task 4 assembly branch + Task 6 assembly variant. ✓
- Real-env e2e (part + assembly, no stub) → Task 6. ✓
- No manifest bump → confirmed (no serialized change; nothing in plan touches fileFormat/migration). ✓

**Type consistency:** `sourceDocument: PartDocument | null` (Task 1) consumed in Task 3/4. Slot type `PartDocument | AssemblyDocument | null` (Task 2) — assembly branch assigns `AssemblyDocument`, part branch `PartDocument`, both fit. `activeDrawingSourceDocument` name identical across all tasks. ✓

**Placeholder scan:** test bodies that say "reuse the existing fixture/mock pattern" reference real, existing harnesses (each spec file exists and already has these patterns) — the implementer must read the existing spec to match its setup; this is adaptation, not a placeholder for missing logic. The production-code snippets are all complete. ✓
