// tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts
/**
 * T-6-18 — Drawing file reopen: staleness pipeline fires on reopen (HAPPY PATH).
 *
 * Tests the full real-bytes loop — NOT the error path:
 *   1. Build box A (50×50×30); save VALID bytes to OPFS at "drawing-source.zipt".
 *   2. Build box B (60×60×40); save bytes (kept in memory for step 5 — we switch
 *      back to box A context before creating the drawing).
 *   3. Switch back to box A; create drawing sourced from "drawing-source.zipt"
 *      (real OPFS read, not fallback) → view.inputFingerprint = djb2(bytes-of-A).
 *   4. Place base view (real projection).
 *   5. Overwrite OPFS at "drawing-source.zipt" with box-B bytes.
 *   6. Call activateDrawingDocument — reads box-B bytes → djb2(bytes-of-B) ≠ inputFingerprint.
 *   7. Assert base view flagged stale (condition b: both fingerprints non-null, different).
 *   8. Click Regenerate → assert stale marker cleared + edges > 0.
 *
 * Real API: kernel.saveToBytes(partId) → Uint8Array (packages/kernel/src/api.ts:71)
 *           + navigator.storage.getDirectory() (raw OPFS FileSystem Access API).
 * Import idiom: await import('/src/...') inside page.evaluate — same as T-6-17.
 *
 * OPFS write/read: implemented inline via raw FileSystem Access API (navigator.storage.getDirectory)
 * to avoid the fragile node_modules import path inside page.evaluate.
 * activateDrawingDocument receives an inline opfs shim satisfying OpfsForLoad (exists + read).
 *
 * Why build box B BEFORE creating the drawing: after CreateDrawingCommand activates a drawing
 * document, the Model ribbon tab disappears (only Drawing, File, View tabs remain). Building
 * box B via the UI requires the Model tab, so it must happen before the drawing is created.
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

  // 2. Save box-A bytes to OPFS at a fixed path; capture partIdA.
  const SOURCE_PATH = 'drawing-source.zipt';
  const { partIdA } = await page.evaluate(
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

      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              activePart: { id: string } | null;
              kernel: {
                execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
                saveToBytes(id: string): Promise<Uint8Array>;
              } | null;
            };
          };
        }
      ).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-18 step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // 3. Build box B (60×60×40) via UI — must happen BEFORE creating the drawing
  //    because after CreateDrawingCommand the Model ribbon tab disappears.
  await buildBox(page, { width: 60, height: 60, depth: 40 });

  // 4. Save box-B bytes to a store slot (globalThis) for later overwrite.
  //    We also return to box-A context by re-activating partIdA in the kernel
  //    (so that CreateDrawingCommand's loadDrawingSource uses partIdA as activePartId fallback
  //    if needed, though the real bytes in OPFS are what matter here).
  await page.evaluate(
    async ({ partIdA: pA }: { partIdA: string }) => {
      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              activePart: { id: string } | null;
              kernel: {
                execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
                saveToBytes(id: string): Promise<Uint8Array>;
              } | null;
            };
          };
        }
      ).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-18 step 4: kernel or activePart not ready');
      // Save box-B bytes to globalThis so we can access them in the overwrite step.
      await s.kernel.execute(s.activePart.id);
      const bytesB = await s.kernel.saveToBytes(s.activePart.id);
      (globalThis as unknown as Record<string, unknown>)['__t618_bytesB'] = bytesB;
      (globalThis as unknown as Record<string, unknown>)['__t618_partIdB'] = s.activePart.id;
      void pA; // partIdA available if needed for assertions
    },
    { partIdA },
  );

  // 5. Create drawing sourced from the real OPFS path (reads box-A bytes from step 2).
  //    This triggers real loadDrawingSource → djb2(bytesA) → activeDrawingSourceFingerprint = fpA.
  const { sheetId, baseViewId } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      const store = (
        window as unknown as {
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
            };
          };
        }
      ).__zilventorStore;

      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const afterCreate = store.getState();
      if (!afterCreate.activeDrawingSourcePartId) {
        throw new Error('T-6-18: activeDrawingSourcePartId null after CreateDrawingCommand');
      }
      if (!afterCreate.activeDrawingSourceFingerprint) {
        throw new Error(
          'T-6-18: activeDrawingSourceFingerprint null — OPFS read took fallback path',
        );
      }
      const fpA = afterCreate.activeDrawingSourceFingerprint;

      const activeDoc = afterCreate.activeDocument!;
      const drawingId = activeDoc.document.id;
      const sheetId = activeDoc.document.sheets[0]!.id;

      // 6. Place base view — real projection; view.inputFingerprint = fpA.
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 =
        s2.activeDocument?.kind === 'drawing' ? s2.activeDocument.document : null;
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
    },
    { sourcePath: SOURCE_PATH },
  );
  void sheetId; // captured for debugging context; baseViewId is what we assert on

  // Switch to drawing tab to confirm base view renders.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 7. Overwrite OPFS source path with box-B bytes (saved to globalThis in step 4).
  //    VALID bytes — kernel.saveToBytes produces a well-formed .zipt archive.
  //    This simulates the user re-saving the source part after editing it.
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

      const bytesB = (globalThis as unknown as Record<string, unknown>)[
        '__t618_bytesB'
      ] as Uint8Array;
      if (!bytesB) throw new Error('T-6-18 step 7: bytesB not in globalThis — step 4 may have failed');
      // Overwrite: bytesB differs from bytesA (different geometry) → different djb2 hash.
      await opfsWrite(sourcePath, bytesB);
    },
    { sourcePath: SOURCE_PATH },
  );

  // 8. Re-activate the drawing: call activateDrawingDocument with the CURRENT in-memory
  //    drawing document (which has the base view with inputFingerprint = fpA).
  //    NOTE: We do NOT read the .zidw from OPFS — CreateDrawingCommand saves to OPFS BEFORE
  //    AddBaseViewCommand runs, so the zidw has an empty sheet. The in-memory doc in the
  //    store has the base view.
  //    activateDrawingDocument reads box-B bytes → djb2(bytesB) ≠ view.inputFingerprint (fpA) → stale.
  await page.evaluate(
    async () => {
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

      // Inline OpfsForLoad shim — no Opfs class import needed.
      const opfsShim = { exists: opfsExists, read: opfsRead };

      const store = (
        window as unknown as {
          __zilventorStore: {
            getState(): {
              kernel: unknown;
              activeDocument: { kind: string; document: unknown } | null;
            };
          };
        }
      ).__zilventorStore;
      const state = store.getState();
      const kernel = state.kernel;

      // Use the in-memory drawing doc (which contains the base view + inputFingerprint).
      // The .zidw on OPFS was written by CreateDrawingCommand BEFORE AddBaseViewCommand,
      // so it has no views — we must use the live store doc.
      const activeDoc = state.activeDocument;
      if (!activeDoc || activeDoc.kind !== 'drawing') {
        throw new Error('T-6-18 step 8: activeDocument is not a drawing');
      }

      const { activateDrawingDocument } = await import(
        '/src/drawing/activateDrawingDocument.ts'
      );
      await activateDrawingDocument(activeDoc.document as never, {
        kernel: kernel as never,
        opfs: opfsShim as never,
      });
    },
  );

  // 9. Assert stale marker appears — condition b fires:
  //    both fingerprints non-null AND fpB (from box-B bytes) ≠ fpA (view.inputFingerprint).
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore).toBeGreaterThan(0);

  // 10. Click Regenerate on the stale base view.
  await page.locator('[data-stale-marker]').first().click();

  // 11. After regen the stale marker count must decrease
  //     (handleRegenerate calls projectViewFromSource with box-B geometry).
  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCountBefore);
  }).toPass({ timeout: 15_000 });

  // 12. The view still renders edges (projection succeeded with box-B geometry).
  const edgeCount = await page
    .locator(`g[data-view-id="${baseViewId}"] polyline`)
    .count();
  expect(edgeCount).toBeGreaterThan(0);
});
