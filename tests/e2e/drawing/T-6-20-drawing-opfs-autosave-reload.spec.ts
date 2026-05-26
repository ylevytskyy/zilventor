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
  // Wait for the kernel to be ready first (status bar 'Ready' or 'Opened').
  await expect(page.getByText(/^(Ready|Opened)$/)).toBeVisible({ timeout: 120_000 });

  // Wait for boot-restore to complete: activeDocument.kind === 'drawing' in the store.
  // This is deterministic — it polls the store state and resolves only after
  // restoreLastOpenDrawing → activateDrawingDocument → setActiveDocument completes.
  await page.waitForFunction(
    () => {
      const store = (window as unknown as {
        __zilventorStore?: {
          getState(): { activeDocument: { kind: string } | null };
        };
      }).__zilventorStore;
      return store?.getState()?.activeDocument?.kind === 'drawing';
    },
    undefined,
    { timeout: 30_000 },
  );

  // 6. Switch to Drawing tab (DrawingCanvas mounts when activeDocument.kind === 'drawing').
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
