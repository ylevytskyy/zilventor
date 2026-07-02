// tests/e2e/drawing/T-6-18-drawing-reopen.spec.ts
/**
 * T-6-18 — Drawing file reopen: REAL pack→unpack→activate round-trip.
 *
 * Tests the full real-bytes loop with a genuine serialize→deserialize round-trip:
 *   1. Build box A (50×50×30); save VALID bytes to OPFS at "drawing-source.zipt".
 *   2. Build box B (60×60×40) via UI (must happen BEFORE creating the drawing —
 *      after CreateDrawingCommand the Model ribbon tab disappears). Save bytesB to globalThis.
 *   3. Switch back to box A context; create drawing + place real base view.
 *      view.inputFingerprint = djb2(bytesA).
 *   4. **REAL ROUND-TRIP** (separate evaluate): REAL packDrawing(in-memory-doc) → Uint8Array
 *      (simulates Save As). unpackDrawing(bytes) → reopenedDoc (simulates Open).
 *      reopenedDoc stored in globalThis.__t618_reopenedDoc.
 *   5. Assert: reopenedDoc.sheets[0].views.length ≥ 1 AND view.inputFingerprint set.
 *      (This would have caught the empty-sheet gap — packDrawing before AddBaseViewCommand
 *      would serialize a doc with no views, and this assertion would fail.)
 *   6. Overwrite OPFS "drawing-source.zipt" with box-B bytes (simulates source part edited).
 *   7. activateDrawingDocument(reopenedDoc, …) — reads box-B bytes → djb2(B) ≠ inputFingerprint(A).
 *   8. Assert base view STALE (condition b: both fingerprints non-null, different).
 *   9. Click Regenerate → assert stale marker cleared + edges > 0.
 *
 * KEY DIFFERENCES from previous spec:
 *   - Step 4 is a SEPARATE page.evaluate call (not bolted onto the CreateDrawing eval).
 *     This avoids a ~30s execution-context-destroyed failure caused by running
 *     CreateDrawingCommand + AddBaseViewCommand + packDrawing all in one long evaluate.
 *   - Step 4 uses the REAL packDrawing() from DrawingPacker.ts (writeTarGz is now a pure
 *     synchronous byte-assembly — no streamx streaming — so it is browser-main-thread safe).
 *   - activateDrawingDocument is called with the DESERIALIZED doc (reopenedDoc), not the
 *     in-memory doc. This exercises the real SaveAs+Open code path.
 *
 * Real API: kernel.saveToBytes(partId) → Uint8Array (packages/kernel/src/api.ts:71)
 *           + navigator.storage.getDirectory() (raw OPFS FileSystem Access API).
 * Import idiom: await import('/src/...') inside page.evaluate — same as T-6-17.
 *
 * OPFS write/read: implemented inline via raw FileSystem Access API.
 * activateDrawingDocument receives an inline opfs shim satisfying OpfsForLoad (exists + read).
 *
 * Why build box B BEFORE creating the drawing: after CreateDrawingCommand activates a drawing
 * document, the Model ribbon tab disappears (only Drawing, File, View tabs remain). Building
 * box B via the UI requires the Model tab, so it must happen before the drawing is created.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-18: drawing reopen — pack→unpack round-trip preserves views + mutated OPFS → stale → Regenerate clears it', async ({ page }) => {
  // Override default 30s action timeout — this test involves WASM cold-start + real projection
  // which can take > 30s on first load. Test timeout is controlled by playwright.config.ts (120s).
  test.setTimeout(120_000);
  page.setDefaultTimeout(90_000);

  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Disable autoRegen: DrawingCanvas's own auto-regen effect (M3.2, DrawingCanvas.tsx
  // ~line 1090, fires whenever the `autoRegen` store flag — default true — sees a stale
  // view) races this spec's manual "assert stale → click Regenerate" flow. Once Regenerate
  // succeeds for real (real box geometry, warm kernel cache), auto-regen can clear the
  // stale marker between the `toBeVisible()` and the following `.count()` read below,
  // making `staleCountBefore` read back 0. This spec is specifically about the manual-click
  // path (see debug-loop root-cause notes on T-6-4-stale-banner-regen.spec.ts for the first
  // occurrence of this race); disable autoRegen to remove it.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { setAutoRegen: (v: boolean) => void } };
    };
    w.__zilventorStore.getState().setAutoRegen(false);
  });

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
  //    NOTE: keep this evaluate identical to the original passing spec — do NOT add
  //    pack/unpack here (that caused an execution-context-destroyed failure when combined
  //    with the long CreateDrawing + AddBaseView operations in one evaluate).
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

  // ─── STEP 4: REAL ROUND-TRIP (separate evaluate) ─────────────────────────────
  // Simulates File → Save As + File → Open using the REAL production APIs:
  //   packDrawing(in-memory-doc)  → Uint8Array  (Save As)
  //   unpackDrawing(bytes)        → reopenedDoc (Open)
  //
  // writeTarGz is now a pure synchronous byte-assembly (no streamx streaming),
  // so packDrawing is browser-main-thread safe and exercises the exact same
  // code path that production handleSaveAs runs.
  //
  // The reopenedDoc is stored in globalThis for the activateDrawingDocument step.
  const { viewCountAfterUnpack, viewHasFingerprint } = await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: unknown;
            } | null;
          };
        };
      }
    ).__zilventorStore;

    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-18 step 4 (pack): activeDocument is not a drawing');
    }
    const inMemoryDoc = state.activeDocument.document;

    // REAL pack → unpack round-trip: both from the REAL DrawingPacker.ts.
    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');

    console.log('[T-6-18] STEP4: calling real packDrawing');
    const packStart = Date.now();
    const packedBytes = await packDrawing(inMemoryDoc as Parameters<typeof packDrawing>[0]);
    console.log('[T-6-18] STEP4: packDrawing done in', Date.now() - packStart, 'ms, bytes:', packedBytes.length);

    console.log('[T-6-18] STEP4: calling real unpackDrawing');
    const unpackStart = Date.now();
    const reopenedDoc = await unpackDrawing(packedBytes);
    console.log('[T-6-18] STEP4: unpackDrawing done in', Date.now() - unpackStart, 'ms, sheets:', (reopenedDoc as { sheets: unknown[] }).sheets.length);

    // Store reopenedDoc in globalThis for the activateDrawingDocument step.
    // activateDrawingDocument MUST receive the deserialized doc (not the in-memory one)
    // to test the real File → Open code path.
    (globalThis as unknown as Record<string, unknown>)['__t618_reopenedDoc'] = reopenedDoc;

    // Extract verification info for Playwright-level assertions (step 5 of the spec).
    const reopenedSheet = (reopenedDoc as { sheets: Array<{ views: Array<{ kind: string; inputFingerprint?: string }> }> }).sheets[0];
    const viewCountAfterUnpack = reopenedSheet?.views.length ?? 0;
    const reopenedBaseView = reopenedSheet?.views.find((v) => v.kind === 'base');
    const viewHasFingerprint = !!(reopenedBaseView?.inputFingerprint);

    return { viewCountAfterUnpack, viewHasFingerprint };
  });

  // ─── STEP 5 ASSERTIONS: pack→unpack round-trip preserved the base view ──────
  // These are the NEW assertions that would have caught the empty-sheet bug.
  // If packDrawing had been called BEFORE AddBaseViewCommand (or if the serialization
  // dropped views), reopenedDoc would have 0 views and these would fail.
  expect(viewCountAfterUnpack, 'reopenedDoc must have ≥1 view after pack→unpack').toBeGreaterThanOrEqual(1);
  expect(viewHasFingerprint, 'reopenedDoc base view must carry inputFingerprint after pack→unpack').toBe(true);

  // Switch to drawing tab to confirm base view renders.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 6. Overwrite OPFS source path with box-B bytes (saved to globalThis in step 4 of original).
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
      if (!bytesB) throw new Error('T-6-18 step 6: bytesB not in globalThis — step 4 may have failed');
      // Overwrite: bytesB differs from bytesA (different geometry) → different djb2 hash.
      await opfsWrite(sourcePath, bytesB);
    },
    { sourcePath: SOURCE_PATH },
  );

  // 7. Re-activate the drawing with the DESERIALIZED reopenedDoc (from unpackDrawing above),
  //    NOT the in-memory doc. This is the critical difference from the old spec:
  //    we pass the doc that went through the real pack→unpack round-trip.
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

      // Use the DESERIALIZED drawing doc (from unpackDrawing in the previous evaluate),
      // NOT the in-memory doc. This is the real File → Open path being tested.
      const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t618_reopenedDoc'];
      if (!reopenedDoc) {
        throw new Error('T-6-18 step 7: reopenedDoc not in globalThis — pack→unpack step may have failed');
      }

      const { activateDrawingDocument } = await import(
        '/src/drawing/activateDrawingDocument.ts'
      );
      await activateDrawingDocument(reopenedDoc as never, {
        kernel: kernel as never,
        opfs: opfsShim as never,
      });
    },
  );

  // 8. Assert stale marker appears — condition b fires:
  //    both fingerprints non-null AND fpB (from box-B bytes) ≠ fpA (view.inputFingerprint).
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  expect(staleCountBefore, 'at least one view must be stale after reopening with mutated source').toBeGreaterThan(0);

  // 9. Click Regenerate on the stale base view.
  await page.locator('[data-stale-marker]').first().click();

  // 10. After regen the stale marker count must decrease
  //     (handleRegenerate calls projectViewFromSource with box-B geometry).
  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCountBefore);
  }).toPass({ timeout: 15_000 });

  // 11. The view still renders edges (projection succeeded with box-B geometry).
  const edgeCount = await page
    .locator(`g[data-view-id="${baseViewId}"] polyline`)
    .count();
  expect(edgeCount, 'regenerated view must have projected edges').toBeGreaterThan(0);
});
