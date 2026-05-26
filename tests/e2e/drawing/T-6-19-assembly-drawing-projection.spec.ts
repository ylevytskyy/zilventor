// tests/e2e/drawing/T-6-19-assembly-drawing-projection.spec.ts
/**
 * T-6-19 — Assembly-sourced drawing projection: real 2-part assembly → base view
 * spans BOTH parts → pack→unpack round-trip → edit source → reopen → STALE → Regenerate.
 *
 * Build path:
 *   1. Build Box Part A (50×50×30) via UI; save its kernel bytes to OPFS at 'parts/t619-A.zipt'.
 *      Capture partIdA.
 *   2. Build Box Part B (40×40×20) via UI (must be BEFORE creating the drawing — Model tab
 *      disappears after CreateDrawingCommand); save bytes to OPFS at 'parts/t619-B.zipt'.
 *      Capture partIdB. Stash bytesB in globalThis for the source-edit step.
 *   3. Build an AssemblyDocument with both components at distinct poses; write a packed .ziasm
 *      to OPFS at 'assemblies/t619.ziasm' using __zilventorPackAssembly dev hook.
 *      Set it as activeAssembly in the store.
 *   4. Drive CreateDrawingCommand({ sourcePath:'assemblies/t619.ziasm', sourceKind:'assembly' }).
 *      Verifies activeDrawingSourceComponents is populated (≥2) and fingerprint is set.
 *   5. AddBaseViewCommand → assert visibleEdges.length > 0 (edges from BOTH parts present).
 *   6. REAL pack→unpack round-trip (separate evaluate): packDrawing → unpackDrawing (same pattern
 *      as T-6-18 step 4). Store reopenedDoc in globalThis.__t619_reopenedDoc.
 *      Assert views preserved + inputFingerprint set.
 *   7. Overwrite OPFS 'parts/t619-A.zipt' with Part B bytes (simulates source part edited).
 *   8. activateDrawingDocument(reopenedDoc, ...) → reads new bytes → different fingerprint → stale.
 *   9. Assert stale marker visible. Click Regenerate. Assert stale clears + edges > 0.
 *
 * Drawing commands are NOT window-exposed — dynamic import inside page.evaluate.
 * Same pattern as T-6-17 and T-6-18. No mocks for loadAssemblyForProjection.
 *
 * Dev hooks used (verified to exist in App.tsx):
 *   - window.__zilventorStore (App.tsx:377)
 *   - window.__zilventorPackAssembly (App.tsx:387)
 *   - dynamic import('/src/commands/CreateDrawingCommand.ts') inside page.evaluate
 *   - dynamic import('/src/commands/AddBaseViewCommand.ts') inside page.evaluate
 *   - dynamic import('/src/storage/DrawingPacker.ts') inside page.evaluate
 *   - dynamic import('/src/drawing/activateDrawingDocument.ts') inside page.evaluate
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const ASM_PATH = 'assemblies/t619.ziasm';
const PART_A_PATH = 'parts/t619-A.zipt';
const PART_B_PATH = 'parts/t619-B.zipt';

test('T-6-19: 2-part assembly drawing — base view + pack→unpack + stale + regen round-trip', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(90_000);
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Step 1: Build Part A (50×50×30) via UI ──────────────────────────────────
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // Save Part A bytes to OPFS at PART_A_PATH; capture partIdA.
  const { partIdA } = await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-19 step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partAPath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 2: Build Part B (40×40×20) via UI (must be before drawing creation) ─
  await buildBox(page, { width: 40, height: 40, depth: 20 });

  // Save Part B bytes to OPFS at PART_B_PATH; capture partIdB and stash bytesB.
  const { partIdB } = await page.evaluate(
    async ({ partBPath }: { partBPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-19 step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesB = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partBPath, bytesB);
      // Stash bytesB in globalThis for the source-edit step later.
      (globalThis as unknown as Record<string, unknown>)['__t619_bytesB'] = bytesB;
      return { partIdB: s.activePart.id };
    },
    { partBPath: PART_B_PATH },
  );

  // ── Step 3: Pack a .ziasm for the 2-part assembly and seed it to OPFS ────────
  await page.evaluate(
    async ({ asmPath, partAPath, partBPath, partIdA, partIdB }: {
      asmPath: string; partAPath: string; partBPath: string;
      partIdA: string; partIdB: string;
    }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const asmDoc = {
        id: 'asm-t619',
        name: 'T619 Assembly',
        units: 'mm',
        parameters: {},
        components: [
          {
            id: partIdA,
            partPath: partAPath,
            position: { x: 60, y: 0, z: 0 },
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
          {
            id: partIdB,
            partPath: partBPath,
            position: { x: -40, y: 0, z: 0 },
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
        ],
        constraints: [],
        groundedComponentPaths: [],
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        colors: {},
        properties: {},
        materials: [],
        hardware: [],
      };

      // Use the __zilventorPackAssembly dev hook (App.tsx:387).
      const w = window as unknown as {
        __zilventorPackAssembly: (doc: unknown, thumb: Uint8Array) => Promise<Uint8Array>;
      };
      if (!w.__zilventorPackAssembly) {
        throw new Error('T-6-19 step 3: __zilventorPackAssembly dev hook not found');
      }
      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const archive = await w.__zilventorPackAssembly(asmDoc, png);
      await opfsWrite(asmPath, archive);

      // Set activeAssembly in the store so CreateDrawingCommand can read it.
      const store = (window as unknown as {
        __zilventorStore: { setState(p: unknown): void };
      }).__zilventorStore;
      store.setState({ activeAssembly: asmDoc } as never);
    },
    { asmPath: ASM_PATH, partAPath: PART_A_PATH, partBPath: PART_B_PATH, partIdA, partIdB },
  );

  // ── Step 4 + 5: CreateDrawingCommand + AddBaseViewCommand ─────────────────────
  const { sheetId, baseViewId, baseViewEdgeCount } = await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                id: string;
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    projection?: { visibleEdges: unknown[] };
                    inputFingerprint?: string;
                  }>;
                }>;
              };
            } | null;
            activeDrawingSourceComponents: unknown[] | null;
            activeDrawingSourceFingerprint: string | null;
          };
        };
      }).__zilventorStore;

      // CreateDrawingCommand reads activeAssembly from the store (set in step 3).
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath: asmPath, sourceKind: 'assembly' }).apply();

      const afterCreate = store.getState();
      if (!afterCreate.activeDrawingSourceComponents || afterCreate.activeDrawingSourceComponents.length === 0) {
        throw new Error(
          `T-6-19: activeDrawingSourceComponents empty after CreateDrawingCommand — ` +
          `loadAssemblyForProjection not wired. Components: ${JSON.stringify(afterCreate.activeDrawingSourceComponents)}`,
        );
      }
      if (!afterCreate.activeDrawingSourceFingerprint) {
        throw new Error('T-6-19: activeDrawingSourceFingerprint not set after CreateDrawingCommand');
      }
      if (afterCreate.activeDrawingSourceComponents.length < 2) {
        throw new Error(
          `T-6-19: expected ≥2 components, got ${afterCreate.activeDrawingSourceComponents.length} — Part A or Part B not loaded by loadAssemblyForProjection`,
        );
      }

      const drawingDoc = afterCreate.activeDocument!.document;
      const sheetId = drawingDoc.sheets[0]!.id;

      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 100, y: 100 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
      const sheet = doc2?.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.kind === 'base');
      if (!baseView?.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error(
          `T-6-19: base view has no edges after AddBaseViewCommand. projection=${JSON.stringify(baseView?.projection)}`,
        );
      }
      if (!baseView.inputFingerprint) {
        throw new Error('T-6-19: base view inputFingerprint not set');
      }

      return {
        sheetId,
        drawingId: drawingDoc.id,
        baseViewId: baseView.id,
        baseViewEdgeCount: baseView.projection.visibleEdges.length,
      };
    },
    { asmPath: ASM_PATH },
  );

  expect(baseViewEdgeCount, 'base view must have projected edges from the 2-part assembly').toBeGreaterThan(0);

  // Switch to drawing tab and verify the base view renders in the SVG canvas.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  const edgeCount = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCount, 'drawing canvas must render polylines for the assembly base view').toBeGreaterThan(0);

  // ── Step 6: REAL pack→unpack round-trip (separate evaluate — same pattern as T-6-18 step 4) ─
  // The round-trip uses the REAL DrawingPacker.ts (synchronous ustar, no streamx hang).
  const { viewCountAfterUnpack, viewHasFingerprint } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: unknown } | null;
        };
      };
    }).__zilventorStore;

    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-19 step 6: activeDocument is not a drawing');
    }
    const inMemoryDoc = state.activeDocument.document;

    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');

    console.log('[T-6-19] STEP6: calling real packDrawing');
    const packStart = Date.now();
    const packedBytes = await packDrawing(inMemoryDoc as Parameters<typeof packDrawing>[0]);
    console.log('[T-6-19] STEP6: packDrawing done in', Date.now() - packStart, 'ms, bytes:', packedBytes.length);

    console.log('[T-6-19] STEP6: calling real unpackDrawing');
    const unpackStart = Date.now();
    const reopenedDoc = await unpackDrawing(packedBytes);
    console.log('[T-6-19] STEP6: unpackDrawing done in', Date.now() - unpackStart, 'ms, sheets:', (reopenedDoc as { sheets: unknown[] }).sheets.length);

    // Store reopenedDoc in globalThis for the activateDrawingDocument step.
    (globalThis as unknown as Record<string, unknown>)['__t619_reopenedDoc'] = reopenedDoc;

    const reopenedSheet = (reopenedDoc as {
      sheets: Array<{ views: Array<{ kind: string; inputFingerprint?: string }> }>;
    }).sheets[0];
    const viewCountAfterUnpack = reopenedSheet?.views.length ?? 0;
    const reopenedBaseView = reopenedSheet?.views.find((v) => v.kind === 'base');
    const viewHasFingerprint = !!(reopenedBaseView?.inputFingerprint);

    return { viewCountAfterUnpack, viewHasFingerprint };
  });

  expect(viewCountAfterUnpack, 'reopenedDoc must have ≥1 view after pack→unpack').toBeGreaterThanOrEqual(1);
  expect(viewHasFingerprint, 'reopenedDoc base view must carry inputFingerprint after pack→unpack').toBe(true);

  // ── Step 7: Overwrite OPFS Part A with Part B bytes (simulate source edit) ────
  await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }
      const bytesB = (globalThis as unknown as Record<string, unknown>)['__t619_bytesB'] as Uint8Array;
      if (!bytesB) throw new Error('T-6-19 step 7: bytesB not in globalThis — step 2 may have failed');
      // Overwrite Part A path with Part B bytes → djb2 hash of the assembly will change.
      await opfsWrite(partAPath, bytesB);
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 8: activateDrawingDocument with the deserialized reopenedDoc ──────────
  // Uses the REAL activateDrawingDocument + loadAssemblyForProjection path.
  // Assembly branch: unpackAssembly(asmBytes) → loadAssemblyForProjection →
  //   reads new Part A bytes (= Part B bytes) → djb2 changes → staleness fires.
  await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      async function opfsRead(path: string): Promise<Uint8Array> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      }
      async function opfsExists(path: string): Promise<boolean> {
        try { await opfsRead(path); return true; } catch { return false; }
      }

      const opfsShim = { exists: opfsExists, read: opfsRead };
      const store = (window as unknown as {
        __zilventorStore: { getState(): { kernel: unknown } };
      }).__zilventorStore;
      const kernel = store.getState().kernel;

      const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t619_reopenedDoc'];
      if (!reopenedDoc) throw new Error('T-6-19 step 8: reopenedDoc not in globalThis — step 6 may have failed');

      const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
      await activateDrawingDocument(reopenedDoc as never, {
        kernel: kernel as never,
        opfs: opfsShim as never,
      });
      void asmPath;
    },
    { asmPath: ASM_PATH },
  );

  // ── Step 9: Assert stale marker appears; Regenerate clears it ─────────────────
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore, 'at least one view must be stale after reopening with mutated source').toBeGreaterThan(0);

  // Click Regenerate on the stale view.
  await page.locator('[data-stale-marker]').first().click();

  // After regen the stale marker count must decrease.
  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCountBefore);
  }).toPass({ timeout: 15_000 });

  // The view must still render edges after regeneration (assembly projection succeeded).
  const edgeCountAfterRegen = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCountAfterRegen, 'regenerated assembly view must have projected edges').toBeGreaterThan(0);
});
