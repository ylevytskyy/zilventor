// tests/e2e/drawing/T-6-24-dxf-1to1-export.spec.ts
/**
 * T-6-24 — DXF 1:1 export: real-environment download + true-size proof.
 *
 *  1. Build a 40×40×20 box part via the UI (real kernel geometry).
 *  2. Save part bytes to OPFS as 'parts/src-T624.zipt'.
 *  3. CreateDrawingCommand (part-sourced) → drawing active; activeDrawingSourceDocument set.
 *  4. AddBaseViewCommand → base view (real OCCT edges, front projection).
 *  5. Force the base view's scale to 1:2 via window.__zilventorStore (WYSIWYG ≠ 1:1).
 *  6. Switch to Drawing tab; assert "Export DXF (1:1)" button is ENABLED (no source stub injected).
 *  7. Stub showSaveFilePicker → anchor-click fallback; click "Export DXF (1:1)"; capture download.
 *  8. Read bytes; assert suggestedFilename matches /-1to1\.dxf$/.
 *  9. Parse VERTEX x-coords; compute X-extent; assert extent ≈ 40mm (not 20mm).
 * 10. Sanity: AC1009 + ENTITIES + ≥1 POLYLINE on VISIBLE layer present.
 * 11. Assert no browser console errors.
 *
 * TEETH: step 5 sets view.scale = 1:2. A renderer that wrongly applied view.scale would emit
 * geometry at 20mm wide and fail the ≈40mm assertion. The button enabled WITHOUT a source stub
 * proves the hasProjectedView gate (not source gate) controls the 1:1 button.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';
import * as fs from 'node:fs';

const SOURCE_PATH = 'parts/src-T624.zipt';

test('T-6-24: DXF 1:1 export — true-size proof (scale 1:2 → extent ≈40mm)', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // ─── Steps 1+2: Build 40×40×20 box; save bytes to OPFS ───────────────────
  await buildBox(page, { width: 40, height: 40, depth: 20 });

  const { partIdA } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts2 = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts2.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts2[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts2[parts2.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<unknown>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;
      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-24 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Steps 3+4: Create drawing + add base view ────────────────────────────
  const { sheetId } = await page.evaluate(
    async ({ sourcePath, partIdA: pA }: { sourcePath: string; partIdA: string }) => {
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
                    projection?: {
                      visibleEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
                      hiddenEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
                      bbox: { minX: number; minY: number; maxX: number; maxY: number };
                    };
                  }>;
                }>;
              };
            } | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceFingerprint: string | null;
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<unknown>;
            } | null;
          };
          setState(partial: unknown): void;
        };
      }).__zilventorStore;

      // Warm kernel cache for the box.
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);

      // Step 3: Create drawing.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-24: activeDrawingSourcePartId null');

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId2 = drawing.sheets[0]!.id;

      // Step 4: Add base view.
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId: sheetId2,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = (s2.activeDocument as {
        document: {
          id: string;
          sheets: Array<{
            id: string;
            views: Array<{
              id: string;
              kind: string;
              projection?: {
                visibleEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
                hiddenEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
                bbox: { minX: number; minY: number; maxX: number; maxY: number };
              };
            }>;
          }>;
        };
      }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheetId2)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-24: base view has no projected edges — kernel projection failed');
      }
      console.log('[T-6-24] base view projected edges:', baseView.projection.visibleEdges.length,
        'hidden:', baseView.projection.hiddenEdges.length);

      return { sheetId: sheetId2 };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  // ─── Step 5: Force base view scale to 1:2 via store ──────────────────────
  // TEETH: the 1:1 renderer must IGNORE view.scale; if it applies it the
  // box geometry would appear 20mm wide and the true-size assertion would fail.
  await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: {
            kind: string;
            document: {
              sheets: Array<{
                views: Array<{ scale: unknown }>;
              }>;
            };
          };
        };
        setState(s: unknown): void;
      };
    }).__zilventorStore;
    const st = store.getState();
    const doc = structuredClone(st.activeDocument.document);
    doc.sheets[0]!.views[0]!.scale = { numerator: 1, denominator: 2 };
    store.setState({ activeDocument: { kind: 'drawing', document: doc }, activeDrawing: doc });
    console.log('[T-6-24] forced base view scale to 1:2');
  });

  // ─── Step 6: Switch to Drawing tab; assert button enabled (no source stub) ─
  // The 1:1 button is gated on hasProjectedView, NOT on source.
  // We inject NO activePart stub — absence is the regression proof.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  const exportBtn = page.getByRole('button', { name: 'Export DXF (1:1)' });
  await expect(
    exportBtn,
    'Export DXF (1:1) must be enabled when a projected view exists — no activePart stub injected',
  ).toBeEnabled({ timeout: 5_000 });

  // ─── Step 7: Stub showSaveFilePicker + capture download ───────────────────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportBtn.click();
  const download = await downloadPromise;

  // ─── Step 8: Assert filename ──────────────────────────────────────────────
  expect(download.suggestedFilename()).toMatch(/-1to1\.dxf$/);
  console.log('[T-6-24] download filename:', download.suggestedFilename());

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const dxfText = fs.readFileSync(downloadPath!, 'utf-8');
  console.log('[T-6-24] DXF length:', dxfText.length, 'chars');

  // ─── Step 9: True-size proof — parse VERTEX x-coords ─────────────────────
  // The renderer ignores view.scale and emits at true model mm.
  // Box is 40mm wide → assert extent ∈ [38,42] and > 30 (rules out 20mm at 1:2).
  const xCoords: number[] = [];
  const lines = dxfText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === 'VERTEX') {
      for (let j = i + 1; j + 1 < lines.length; j++) {
        if (lines[j]!.trim() === 'VERTEX' || lines[j]!.trim() === 'SEQEND') break;
        if (lines[j] === ' 10') {
          xCoords.push(parseFloat(lines[j + 1]!));
          break;
        }
      }
    }
  }
  expect(xCoords.length, 'Must have ≥1 VERTEX with x-coordinate').toBeGreaterThan(0);
  const xMin = Math.min(...xCoords);
  const xMax = Math.max(...xCoords);
  const extent = xMax - xMin;
  console.log(`[T-6-24] true-size x-extent = ${extent.toFixed(3)} mm (xMin=${xMin.toFixed(3)}, xMax=${xMax.toFixed(3)})`);

  // Strict > 30 rules out 20mm (scaled); [38,42] catches OCCT tessellation tolerance.
  expect(extent, `True-size x-extent must be > 30mm (not 20mm 1:2 result). Got: ${extent.toFixed(3)}`).toBeGreaterThan(30);
  expect(extent, `True-size x-extent must be ≤ 42mm. Got: ${extent.toFixed(3)}`).toBeLessThanOrEqual(42);
  expect(extent, `True-size x-extent must be ≥ 38mm. Got: ${extent.toFixed(3)}`).toBeGreaterThanOrEqual(38);

  // ─── Step 10: Structural sanity checks ───────────────────────────────────
  expect(dxfText, 'DXF must contain AC1009 header').toContain('AC1009');
  expect(dxfText, 'DXF must contain ENTITIES section').toContain('ENTITIES');

  // At least one POLYLINE on VISIBLE layer.
  const pairs: Array<[number, string]> = [];
  const trimLines = dxfText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = 0; i + 1 < trimLines.length; i += 2) {
    const code = parseInt(trimLines[i]!, 10);
    if (!isNaN(code)) pairs.push([code, trimLines[i + 1]!]);
  }
  let visiblePolylineCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'POLYLINE') {
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'VISIBLE') visiblePolylineCount++;
          break;
        }
      }
    }
  }
  console.log('[T-6-24] VISIBLE-layer POLYLINE count:', visiblePolylineCount);
  expect(visiblePolylineCount, 'At least one POLYLINE on VISIBLE layer required').toBeGreaterThan(0);

  // ─── Step 11: No browser console errors ──────────────────────────────────
  if (consoleErrors.length > 0) {
    console.log('[T-6-24] BROWSER ERRORS:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser console errors during DXF 1:1 export').toHaveLength(0);

  console.log(`[T-6-24] PASSED: filename=${download.suggestedFilename()}, extent=${extent.toFixed(3)}mm, visiblePolylines=${visiblePolylineCount}`);
});
