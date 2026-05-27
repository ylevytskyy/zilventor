// tests/e2e/drawing/T-6-27-source-optional-export.spec.ts
/**
 * T-6-27 — Source-absent WYSIWYG DXF export: export buttons enabled and produce
 * valid geometry when ALL three source slots are null.
 *
 * This spec proves the Task 6 gate swap (DrawingTab: source → hasProjectedView).
 * Before the fix the "Export DXF" button was disabled whenever source was absent.
 * After the fix it stays enabled as long as the active sheet has a projected view —
 * regardless of activePart / activeAssembly / activeDrawingSourceDocument.
 *
 * Steps:
 *  1. Boot app; build a 40×40×20 box; save bytes to OPFS as 'parts/src-T627.zipt'.
 *  2. CreateDrawingCommand (part-sourced) + AddBaseViewCommand → real projected view.
 *  3. Via the store bridge, null ALL THREE source slots:
 *       activePart = null, activeAssembly = null, activeDrawingSourceDocument = null.
 *  4. Switch to Drawing tab.
 *  5. Assert "Export DXF" button is ENABLED (exact: true — superstring-label trap guard).
 *  6. Stub showSaveFilePicker = undefined → anchor-click fallback → Playwright download event.
 *  7. Click Export DXF; capture download; read DXF text.
 *  8. Parse-back assertions:
 *       a. Contains ENTITIES section.
 *       b. Contains EOF terminator.
 *       c. At least one POLYLINE entity (geometry survived without source).
 *       d. At least one VERTEX entity.
 *       e. At least one TEXT entity (degraded title block still emits text rows).
 *  9. Confirm no browser errors.
 *
 * SELECTOR NOTE: "Export DXF" is a substring of "Export DXF (1:1)".
 * Without exact:true the selector matches both → strict-mode violation.
 * Always use getByRole('button', { name: 'Export DXF', exact: true }).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

/** Parse DXF text into an array of [groupCode, value] pairs. */
function parseDxf(text: string): Array<[number, string]> {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i]!, 10);
    if (!isNaN(code)) pairs.push([code, lines[i + 1]!]);
  }
  return pairs;
}

const SOURCE_PATH = 'parts/src-T627.zipt';

test('T-6-27: source-absent WYSIWYG DXF export — buttons enabled and geometry survives', async ({ page }) => {
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

  // ─── Step 1+2: Build box; save bytes to OPFS ─────────────────────────────
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
      if (!s.activePart || !s.kernel) throw new Error('T-6-27 step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 3–5: Create drawing + base view with real projected geometry ────
  const { sheetId, projectedEdgeCount } = await page.evaluate(
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

      // Warm kernel cache (so projector can load the box part).
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);

      // Create drawing sourced from OPFS box path.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId2 = drawing.sheets[0]!.id;

      // Add base view with real OCCT projection.
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
          sheets: Array<{
            id: string;
            views: Array<{
              id: string;
              kind: string;
              projection?: {
                visibleEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
                hiddenEdges: Array<{ id: string; points: Array<readonly [number, number]> }>;
              };
            }>;
          }>;
        };
      }).document;

      const sh2 = doc2.sheets.find((s) => s.id === sheetId2)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-27: base view has no projected edges — kernel projection failed');
      }
      console.log('[T-6-27] base view projected edges:', baseView.projection.visibleEdges.length,
        'hidden:', baseView.projection.hiddenEdges.length);

      return {
        sheetId: sheetId2,
        projectedEdgeCount: baseView.projection.visibleEdges.length + baseView.projection.hiddenEdges.length,
      };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  expect(projectedEdgeCount, 'base view must have at least 1 projected edge').toBeGreaterThan(0);

  // ─── Step 6: Null ALL THREE source slots ─────────────────────────────────
  // This is the heart of the test: DrawingTab must still enable Export DXF
  // because the gate is now hasProjectedView, NOT source presence.
  await page.evaluate(() => {
    (window as unknown as {
      __zilventorStore: { setState(p: unknown): void };
    }).__zilventorStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDrawingSourceDocument: null,
    });
    console.log('[T-6-27] all source slots nulled: activePart=null, activeAssembly=null, activeDrawingSourceDocument=null');
  });

  // Verify all three slots are actually null (belt-and-suspenders).
  const storeState = await page.evaluate(() => {
    const s = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: unknown;
          activeAssembly: unknown;
          activeDrawingSourceDocument: unknown;
        };
      };
    }).__zilventorStore.getState();
    return {
      activePart: s.activePart,
      activeAssembly: s.activeAssembly,
      activeDrawingSourceDocument: s.activeDrawingSourceDocument,
    };
  });
  expect(storeState.activePart, 'activePart must be null').toBeNull();
  expect(storeState.activeAssembly, 'activeAssembly must be null').toBeNull();
  expect(storeState.activeDrawingSourceDocument, 'activeDrawingSourceDocument must be null').toBeNull();

  // ─── Step 7: Switch to Drawing tab ───────────────────────────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // ─── Step 8: Assert "Export DXF" button is ENABLED ───────────────────────
  // exact: true required — "Export DXF" is a substring of "Export DXF (1:1)".
  // Without it, getByRole matches both buttons in strict mode → selector violation.
  const exportDxfBtn = page.getByRole('button', { name: 'Export DXF', exact: true });
  await expect(
    exportDxfBtn,
    'Export DXF must be ENABLED when source slots are null but a projected view exists (gate = hasProjectedView)',
  ).toBeEnabled({ timeout: 5_000 });

  console.log('[T-6-27] Export DXF button is ENABLED with all source slots null — gate swap confirmed');

  // ─── Step 9: Stub showSaveFilePicker → anchor-click fallback ─────────────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  // ─── Step 10: Click Export DXF + capture download ────────────────────────
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportDxfBtn.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  console.log('[T-6-27] download filename:', download.suggestedFilename());

  // ─── Step 11: Read DXF content ───────────────────────────────────────────
  const downloadPath = await download.path();
  expect(downloadPath, 'download path must be truthy').toBeTruthy();
  const dxfText = fs.readFileSync(downloadPath!, 'utf-8');
  console.log('[T-6-27] DXF length:', dxfText.length, 'chars');

  expect(dxfText.length, 'DXF must be non-trivially long (>200 chars)').toBeGreaterThan(200);

  // ─── Step 12: Parse-back assertions ──────────────────────────────────────
  const pairs = parseDxf(dxfText);
  expect(pairs.length, 'DXF must parse to >10 group-code pairs').toBeGreaterThan(10);

  const code0Values = pairs.filter(([c]) => c === 0).map(([, v]) => v);

  // 12a. ENTITIES section present.
  expect(dxfText, 'ENTITIES section must be present').toContain('ENTITIES');

  // 12b. EOF terminator present (exactly once).
  const eofCount = code0Values.filter((v) => v === 'EOF').length;
  expect(eofCount, 'EOF must be present exactly once').toBe(1);

  // 12c. At least one POLYLINE entity (geometry survived without source).
  const polylineCount = code0Values.filter((v) => v === 'POLYLINE').length;
  console.log('[T-6-27] POLYLINE count:', polylineCount);
  expect(polylineCount, 'At least one POLYLINE entity required (projected geometry survived without source)').toBeGreaterThan(0);

  // 12d. At least one VERTEX entity (POLYLINE body).
  const vertexCount = code0Values.filter((v) => v === 'VERTEX').length;
  console.log('[T-6-27] VERTEX count:', vertexCount);
  expect(vertexCount, 'At least one VERTEX entity required (projected geometry body)').toBeGreaterThan(0);

  // 12e. At least one TEXT entity (degraded title block still emits text rows).
  const textCount = code0Values.filter((v) => v === 'TEXT').length;
  console.log('[T-6-27] TEXT count:', textCount);
  expect(textCount, 'At least one TEXT entity required (degraded title block)').toBeGreaterThanOrEqual(1);

  // 12f. SECTION/ENDSEC balanced — structural integrity check.
  const sectionCount = code0Values.filter((v) => v === 'SECTION').length;
  const endsecCount  = code0Values.filter((v) => v === 'ENDSEC').length;
  expect(sectionCount, 'SECTION and ENDSEC must be balanced').toBe(endsecCount);
  expect(sectionCount, 'Must have exactly 4 DXF sections').toBe(4);

  // ─── Step 13: No browser errors ──────────────────────────────────────────
  if (consoleErrors.length > 0) {
    console.log('[T-6-27] BROWSER ERRORS:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser errors during source-absent export').toHaveLength(0);

  console.log(
    `[T-6-27] PASSED: source-absent export — polylines=${polylineCount}, vertices=${vertexCount}, texts=${textCount}, sections=${sectionCount}`,
    `\n         Sheet: ${sheetId} | projected edges: ${projectedEdgeCount}`,
  );
});
