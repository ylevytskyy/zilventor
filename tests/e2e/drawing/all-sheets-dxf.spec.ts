// tests/e2e/drawing/all-sheets-dxf.spec.ts
/**
 * T-6-25 — All-sheets DXF export: real-environment 2-sheet zip round-trip.
 *
 * Goal: Verify both "Export All Sheets (DXF)" (WYSIWYG) and "Export All Sheets (1:1)"
 * buttons produce a valid zip with one DXF per sheet.
 *
 * Steps:
 *   1.  Build a 40×40×20 box part via the UI (real kernel geometry).
 *   2.  Save part bytes to OPFS as 'parts/src-T625.zipt'.
 *   3.  CreateDrawingCommand (part-sourced) → drawing active; activeDrawingSourceDocument set.
 *   4.  AddBaseViewCommand on Sheet 1 → real OCCT edges, front projection.
 *   5.  AddSheetCommand → creates Sheet 2 (auto-named).
 *   6.  AddBaseViewCommand on Sheet 2 → real OCCT edges, top projection.
 *   7.  Force Sheet 1's base view scale to 1:2 via store (TEETH for 1:1 renderer).
 *   8.  Switch to Drawing tab; assert both all-sheets buttons are PRESENT and ENABLED.
 *       (buttons only render when sheets.length > 1)
 *   9.  Stub showSaveFilePicker → anchor-click fallback.
 *  10.  Click "Export All Sheets (DXF)"; capture WYSIWYG zip download.
 *  11.  Click "Export All Sheets (1:1)"; capture 1:1 zip download.
 *  12.  Parse WYSIWYG zip: assert 2 entries named 01-*.dxf / 02-*.dxf, each contains
 *       AC1009 and ENTITIES.
 *  13.  Parse 1:1 zip: assert 2 entries named *-1to1.dxf; assert ≥1 entry has real
 *       true-mm geometry (x-extent > 30mm mirrors T-6-24's scale-indifference proof).
 *  14.  Assert no browser console errors (production gaps surface here first).
 *
 * TEETH:
 *   - Two-sheet requirement: the buttons only render when sheets.length > 1 — any regression
 *     removing the gate would make the buttons invisible and fail step 8.
 *   - Scale-indifference proof (step 7): Sheet 1 scale forced 1:2. The 1:1 renderer must
 *     ignore scale; a buggy renderer gives 20mm width instead of 40mm — caught by step 13.
 *   - No source stub: activeDrawingSourceDocument is set by CreateDrawingCommand; absence of
 *     activePart/activeAssembly is not a regression from the 1:1 button's perspective
 *     (it is gated on anySheetHasProjectedView, not on source).
 *   - WYSIWYG button IS gated on source — we verify activeDrawingSourceDocument is set
 *     (not null) which means the WYSIWYG button should be enabled.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';
import { unzipSync, strFromU8 } from 'fflate';
import * as fs from 'node:fs';

const SOURCE_PATH = 'parts/src-T625.zipt';

test('T-6-25: all-sheets DXF export — 2-sheet zip round-trip (WYSIWYG + 1:1)', async ({ page }) => {
  test.setTimeout(300_000);
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
        const segs = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segs.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segs[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segs[segs.length - 1]!, { create: true });
        const w = await fh.createWritable();
        await w.write(data as unknown as FileSystemWriteChunkType);
        await w.close();
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
      if (!s.activePart || !s.kernel) throw new Error('T-6-25 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Steps 3+4: Create drawing + add base view on Sheet 1 ────────────────
  const { sheet1Id } = await page.evaluate(
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
            kernel: {
              execute(id: string): Promise<unknown>;
            } | null;
          };
          setState(partial: unknown): void;
        };
      }).__zilventorStore;

      // Warm kernel cache.
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);

      // Step 3: Create drawing.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-25: activeDrawingSourcePartId null');

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheet1Id2 = drawing.sheets[0]!.id;

      // Step 4: Add base view on Sheet 1 (front projection, scale 1:1).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId: sheet1Id2,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      // Verify projection landed on sheet 1.
      const s2 = store.getState();
      const doc2 = (s2.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ kind: string; projection?: unknown }> }> };
      }).document;
      const sh1 = doc2.sheets.find((s) => s.id === sheet1Id2)!;
      const bv1 = sh1.views.find((v) => v.kind === 'base');
      if (!bv1?.projection) {
        throw new Error('T-6-25: Sheet 1 base view has no projection — kernel projection failed');
      }
      console.log('[T-6-25] Sheet 1 base view projection OK');

      return { sheet1Id: sheet1Id2 };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  // ─── Step 5+6: Add Sheet 2 + base view ───────────────────────────────────
  const { sheet2Id } = await page.evaluate(
    async ({ sheet1Id: s1 }: { sheet1Id: string }) => {
      // Step 5: Add Sheet 2.
      const { AddSheetCommand } = await import('/src/commands/AddSheetCommand.ts');
      await new AddSheetCommand({}).apply();

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                sheets: Array<{ id: string; views: Array<{ kind: string; projection?: unknown }> }>;
              };
            } | null;
          };
        };
      }).__zilventorStore;
      const s1State = store.getState();
      const doc1 = (s1State.activeDocument as {
        document: { sheets: Array<{ id: string }> };
      }).document;
      // Sheet 2 is the newly added sheet (last in array, not equal to sheet1Id).
      const sheet2Id2 = doc1.sheets.find((s) => s.id !== s1)?.id;
      if (!sheet2Id2) throw new Error('T-6-25: AddSheetCommand did not create Sheet 2');
      console.log('[T-6-25] Sheet 2 created:', sheet2Id2);

      // Step 6: Add base view on Sheet 2 (top projection, scale 1:1).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId: sheet2Id2,
        positionMm: { x: 80, y: 80 },
        orientation: 'top',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      // Verify projection landed on sheet 2.
      const s2State = store.getState();
      const doc2 = (s2State.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ kind: string; projection?: unknown }> }> };
      }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheet2Id2)!;
      const bv2 = sh2.views.find((v) => v.kind === 'base');
      if (!bv2?.projection) {
        throw new Error('T-6-25: Sheet 2 base view has no projection — kernel projection failed');
      }
      console.log('[T-6-25] Sheet 2 base view projection OK');

      return { sheet2Id: sheet2Id2 };
    },
    { sheet1Id },
  );

  // ─── Step 7: Force Sheet 1's base view scale to 1:2 (TEETH) ─────────────
  // TEETH: 1:1 renderer must IGNORE view.scale. If it applies scale, extent ≈ 20mm (fails step 13).
  await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: {
            kind: string;
            document: { sheets: Array<{ views: Array<{ scale: unknown }> }> };
          };
        };
        setState(s: unknown): void;
      };
    }).__zilventorStore;
    const st = store.getState();
    const doc = structuredClone(st.activeDocument.document);
    // Patch Sheet 1's first view scale to 1:2.
    doc.sheets[0]!.views[0]!.scale = { numerator: 1, denominator: 2 };
    store.setState({ activeDocument: { kind: 'drawing', document: doc }, activeDrawing: doc });
    console.log('[T-6-25] forced Sheet 1 base view scale to 1:2');
  });

  // ─── Step 8: Switch to Drawing tab; assert buttons present + enabled ──────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // Both all-sheets buttons must be present (drawing has 2 sheets → isMultiSheet=true).
  const wysiwygBtn = page.getByRole('button', { name: /^export all sheets \(dxf\)$/i });
  const oneToOneBtn = page.getByRole('button', { name: /^export all sheets \(1:1\)$/i });

  await expect(wysiwygBtn, 'Export All Sheets (DXF) button must be present for a 2-sheet drawing').toBeVisible({ timeout: 5_000 });
  await expect(oneToOneBtn, 'Export All Sheets (1:1) button must be present for a 2-sheet drawing').toBeVisible({ timeout: 5_000 });

  // WYSIWYG button is gated on source (activeDrawingSourceDocument).
  await expect(wysiwygBtn, 'Export All Sheets (DXF) must be enabled (activeDrawingSourceDocument set)').toBeEnabled({ timeout: 5_000 });
  // 1:1 button is gated on anySheetHasProjectedView.
  await expect(oneToOneBtn, 'Export All Sheets (1:1) must be enabled (both sheets have projected views)').toBeEnabled({ timeout: 5_000 });

  // ─── Step 9: Stub showSaveFilePicker ────────────────────────────────────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  // ─── Step 10: Click "Export All Sheets (DXF)"; capture WYSIWYG zip ───────
  const wysiwygDownloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await wysiwygBtn.click();
  const wysiwygDownload = await wysiwygDownloadPromise;

  console.log('[T-6-25] WYSIWYG download filename:', wysiwygDownload.suggestedFilename());
  expect(wysiwygDownload.suggestedFilename()).toMatch(/\.zip$/);

  // ─── Step 11: Click "Export All Sheets (1:1)"; capture 1:1 zip ────────
  const oneToOneDownloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await oneToOneBtn.click();
  const oneToOneDownload = await oneToOneDownloadPromise;

  console.log('[T-6-25] 1:1 download filename:', oneToOneDownload.suggestedFilename());
  expect(oneToOneDownload.suggestedFilename()).toMatch(/\.zip$/);

  // ─── Step 12: Parse WYSIWYG zip ───────────────────────────────────────────
  const wysiwygPath = await wysiwygDownload.path();
  expect(wysiwygPath, 'WYSIWYG zip download path must be truthy').toBeTruthy();
  const wysiwygZipBytes = new Uint8Array(fs.readFileSync(wysiwygPath!));
  const wysiwygEntries = unzipSync(wysiwygZipBytes);
  const wysiwygNames = Object.keys(wysiwygEntries).sort();

  console.log('[T-6-25] WYSIWYG zip entries:', wysiwygNames);
  expect(wysiwygNames, 'WYSIWYG zip must have exactly 2 entries').toHaveLength(2);
  expect(wysiwygNames[0], 'First WYSIWYG entry must match 01-*.dxf').toMatch(/^01-.*\.dxf$/);
  expect(wysiwygNames[1], 'Second WYSIWYG entry must match 02-*.dxf').toMatch(/^02-.*\.dxf$/);

  // Each entry must be a valid R12 DXF.
  for (const name of wysiwygNames) {
    const content = strFromU8(wysiwygEntries[name]!);
    expect(content, `${name} must contain AC1009 header`).toContain('AC1009');
    expect(content, `${name} must contain ENTITIES section`).toContain('ENTITIES');
  }

  // ─── Step 13: Parse 1:1 zip + true-mm proof ───────────────────────────────
  const oneToOnePath = await oneToOneDownload.path();
  expect(oneToOnePath, '1:1 zip download path must be truthy').toBeTruthy();
  const oneToOneZipBytes = new Uint8Array(fs.readFileSync(oneToOnePath!));
  const oneToOneEntries = unzipSync(oneToOneZipBytes);
  const oneToOneNames = Object.keys(oneToOneEntries).sort();

  console.log('[T-6-25] 1:1 zip entries:', oneToOneNames);
  expect(oneToOneNames, '1:1 zip must have exactly 2 entries').toHaveLength(2);
  expect(oneToOneNames[0], 'First 1:1 entry must contain -1to1.dxf suffix').toMatch(/-1to1\.dxf$/);
  expect(oneToOneNames[1], 'Second 1:1 entry must contain -1to1.dxf suffix').toMatch(/-1to1\.dxf$/);

  // True-mm proof on first entry (Sheet 1 has 40×40 front face, scale forced 1:2 in step 7).
  // A renderer that applied view.scale would emit 20mm width — fails ≥ 38mm assertion.
  const firstEntry1to1 = strFromU8(oneToOneEntries[oneToOneNames[0]!]!);
  expect(firstEntry1to1, 'First 1:1 entry must contain AC1009 header').toContain('AC1009');
  expect(firstEntry1to1, 'First 1:1 entry must contain ENTITIES section').toContain('ENTITIES');

  // Parse VERTEX x-coords from first 1:1 entry.
  const xCoords: number[] = [];
  const lines = firstEntry1to1.split('\n');
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
  expect(xCoords.length, 'First 1:1 entry must have ≥1 VERTEX with x-coordinate').toBeGreaterThan(0);
  const xMin = Math.min(...xCoords);
  const xMax = Math.max(...xCoords);
  const extent = xMax - xMin;
  console.log(`[T-6-25] 1:1 true-size x-extent = ${extent.toFixed(3)} mm (xMin=${xMin.toFixed(3)}, xMax=${xMax.toFixed(3)})`);

  // Strict > 30 rules out 20mm (1:2 scaled result). [38, 42] catches OCCT tessellation tolerance.
  expect(extent, `True-size x-extent must be > 30mm (not 20mm from a scale-applying renderer). Got: ${extent.toFixed(3)}`).toBeGreaterThan(30);
  expect(extent, `True-size x-extent must be ≤ 42mm. Got: ${extent.toFixed(3)}`).toBeLessThanOrEqual(42);
  expect(extent, `True-size x-extent must be ≥ 38mm. Got: ${extent.toFixed(3)}`).toBeGreaterThanOrEqual(38);

  // ─── Step 14: No browser console errors ───────────────────────────────────
  if (consoleErrors.length > 0) {
    console.log('[T-6-25] BROWSER ERRORS:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser console errors during all-sheets DXF exports').toHaveLength(0);

  console.log(
    `[T-6-25] PASSED: WYSIWYG entries=[${wysiwygNames.join(', ')}], ` +
    `1:1 entries=[${oneToOneNames.join(', ')}], ` +
    `extent=${extent.toFixed(3)}mm, sheet1Id=${sheet1Id}, sheet2Id=${sheet2Id}`,
  );
});
