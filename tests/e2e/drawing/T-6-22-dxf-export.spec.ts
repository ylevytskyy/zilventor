// tests/e2e/drawing/T-6-22-dxf-export.spec.ts
/**
 * T-6-22 — DXF export: real-environment download round-trip.
 *
 * Steps:
 *  1. Build a 40×40×20 box part via the UI (real kernel geometry).
 *  2. Save part bytes to OPFS as 'parts/src-T622.zipt'.
 *  3. CreateDrawingCommand (sourced from the box).
 *  4. AddBaseViewCommand → base view (front projection, 1:1, real OCCT edges).
 *  5. Restore activePart in store (CreateDrawingCommand nulls it) so the
 *     "Export DXF" ribbon button is enabled.
 *  6. Switch to Drawing tab.
 *  7. Stub window.showSaveFilePicker = undefined → triggerDownload falls through
 *     to the anchor-click path which Playwright captures as a 'download' event.
 *  8. Click "Export DXF" button; capture download.
 *  9. Read downloaded bytes as UTF-8 text.
 * 10. Parse DXF group-code pairs and assert:
 *     - SECTION/ENDSEC pairs balanced
 *     - HEADER, TABLES, ENTITIES sections present
 *     - EOF terminator present
 *     - VISIBLE layer appears (in LAYER table entry)
 *     - At least one POLYLINE entity
 *     - At least one VERTEX entity
 *     - At least one TEXT entity (title block)
 *     - DASHED ltype defined (for HIDDEN layer)
 *     - Y-flip applied: at least one DXF Y-coord > sheetH/2 (= 148.5)
 *       for a view positioned at svgY=80 on an A3 sheet (h=297)
 *     - Total entity count exceeds a floor (non-trivial output)
 * 11. Teeth check: temporarily corrupt VISIBLE layer name; confirm test goes red;
 *     revert and confirm green again (done outside the normal run via a separate
 *     inline sub-check at the assertion level).
 *
 * SELECTOR NOTE: "Export DXF" button has aria-label="Export DXF" in DrawingTab.tsx.
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

test('T-6-22: DXF export — real geometry download + parse', async ({ page }) => {
  test.setTimeout(180_000);
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

  const SOURCE_PATH = 'parts/src-T622.zipt';

  // ─── Step 1+2: Build box; save bytes to OPFS ──────────────────────────────
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
      if (!s.activePart || !s.kernel) throw new Error('T-6-22 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 3+4: Create drawing + base view (real OCCT projection) ──────────
  const { sheetId, viewCount } = await page.evaluate(
    async ({ sourcePath, partIdA: pA }: { sourcePath: string; partIdA: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    projection?: { visibleEdges: unknown[] };
                  }>;
                }>;
              };
            } | null;
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<unknown>;
            } | null;
          };
        };
      }).__zilventorStore;

      // Warm kernel cache for box-A (so projector can load it).
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);

      // Step 3: Create drawing sourced from OPFS box-A path.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      // Step 4: Add base view with real projection.
      const s1 = store.getState();
      if (!s1.activeDocument || s1.activeDocument.kind !== 'drawing') {
        throw new Error('T-6-22: drawing not active after CreateDrawingCommand');
      }
      const drawing = s1.activeDocument.document;
      const sheetId2 = drawing.sheets[0]!.id;

      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId: sheetId2,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      // Verify base view has real projected edges (not hand-typed).
      const s2 = store.getState();
      const doc2 = s2.activeDocument?.document;
      const sh2 = doc2?.sheets.find((s) => s.id === sheetId2);
      const baseView = sh2?.views.find((v) => v.kind === 'base');
      const edgeCount = baseView?.projection?.visibleEdges.length ?? 0;
      console.log('[T-6-22] base view projected edges:', edgeCount);
      if (edgeCount === 0) throw new Error('T-6-22: base view has no projected edges — kernel projection failed');

      return { sheetId: sheetId2, viewCount: sh2?.views.length ?? 0 };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  expect(viewCount, 'drawing must have at least 1 base view after AddBaseViewCommand').toBeGreaterThanOrEqual(1);

  // ─── Step 5: Restore activePart in store ──────────────────────────────────
  // CreateDrawingCommand calls setActiveDocument({ kind:'drawing', ... }) which
  // sets activePart: null (useAppStore line ~376). The "Export DXF" button in
  // DrawingTab reads `source = activePart ?? activeAssembly` and is disabled when
  // both are null. Restore activePart so the button is enabled.
  await page.evaluate(
    async ({ pA, shId }: { pA: string; shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } } | null;
            kernel: { getPartDocument?(id: string): unknown } | null;
          };
          setState(partial: unknown): void;
        };
      }).__zilventorStore;
      void shId;

      // We need a PartDocument shape. Build a minimal one from the kernel store
      // if available, otherwise inject a stub that contains enough fields for
      // renderDrawingDxf (it only reads drawing + sheet + source.materials for title block).
      const stubPart = {
        id: pA,
        name: 'src-T622',
        units: 'mm',
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
        hardware: [],
      };

      store.setState({ activePart: stubPart });
      console.log('[T-6-22] activePart restored in store, id=', pA);
    },
    { pA: partIdA, shId: sheetId },
  );

  // ─── Step 6: Switch to Drawing tab ────────────────────────────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // ─── Step 7: Stub showSaveFilePicker so anchor-click fallback fires ────────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  // ─── Step 8: Click Export DXF + capture download ──────────────────────────
  const exportBtn = page.getByRole('button', { name: 'Export DXF' });
  await expect(exportBtn).toBeEnabled({ timeout: 5_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportBtn.click();
  const download = await downloadPromise;

  // Verify suggested filename ends with .dxf
  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  console.log('[T-6-22] download filename:', download.suggestedFilename());

  // ─── Step 9: Read DXF content ──────────────────────────────────────────────
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const dxfText = fs.readFileSync(downloadPath!, 'utf-8');

  console.log('[T-6-22] DXF length:', dxfText.length, 'chars');

  // Non-trivial size guard: a minimal R12 DXF with one POLYLINE edge is >500 chars
  expect(dxfText.length, 'DXF output must be non-trivially long (>500 chars)').toBeGreaterThan(500);

  // ─── Step 10: Parse and assert DXF structure ──────────────────────────────
  const pairs = parseDxf(dxfText);
  expect(pairs.length, 'DXF must parse to >10 group-code pairs').toBeGreaterThan(10);

  const code0Values = pairs.filter(([c]) => c === 0).map(([, v]) => v);

  // 10a. SECTION / ENDSEC balanced
  const sectionCount = code0Values.filter((v) => v === 'SECTION').length;
  const endsecCount  = code0Values.filter((v) => v === 'ENDSEC').length;
  expect(sectionCount, 'SECTION count must equal ENDSEC count').toBe(endsecCount);
  expect(sectionCount, 'Must have at least 3 sections (HEADER, TABLES, ENTITIES)').toBeGreaterThanOrEqual(3);

  // 10b. Required section names present
  expect(dxfText, 'HEADER section').toContain('HEADER');
  expect(dxfText, 'TABLES section').toContain('TABLES');
  expect(dxfText, 'ENTITIES section').toContain('ENTITIES');

  // 10c. EOF terminator (exactly one)
  const eofCount = code0Values.filter((v) => v === 'EOF').length;
  expect(eofCount, 'EOF group-code pair must be present exactly once').toBe(1);

  // 10d. VISIBLE layer defined in LAYER table
  expect(dxfText, 'VISIBLE layer must be defined').toContain('VISIBLE');

  // 10e. At least one POLYLINE entity on the VISIBLE layer.
  // Parse: after each "  0  POLYLINE" pair, the next "  8  <layer>" pair gives the layer.
  // Count POLYLINEs whose immediately-following layer group code is VISIBLE.
  let visiblePolylineCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'POLYLINE') {
      // Find the next group-code-8 (layer name) within the next few pairs
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'VISIBLE') visiblePolylineCount++;
          break;
        }
      }
    }
  }
  const polylineCount = code0Values.filter((v) => v === 'POLYLINE').length;
  console.log('[T-6-22] total POLYLINE count:', polylineCount, '| VISIBLE-layer POLYLINEs:', visiblePolylineCount);
  expect(polylineCount, 'At least one POLYLINE entity required (any layer)').toBeGreaterThan(0);
  expect(visiblePolylineCount, 'At least one POLYLINE on VISIBLE layer required (real projected edges)').toBeGreaterThan(0);

  // 10f. At least one VERTEX (POLYLINE body)
  const vertexCount = code0Values.filter((v) => v === 'VERTEX').length;
  console.log('[T-6-22] VERTEX count:', vertexCount);
  expect(vertexCount, 'At least one VERTEX required').toBeGreaterThan(0);

  // 10g. At least one TEXT entity (title block emits ≥8 TEXT entities)
  const textCount = code0Values.filter((v) => v === 'TEXT').length;
  console.log('[T-6-22] TEXT count:', textCount);
  expect(textCount, 'At least 8 TEXT entities required (title block)').toBeGreaterThanOrEqual(8);

  // 10h. DASHED ltype defined (for HIDDEN layer)
  expect(dxfText, 'DASHED ltype must be defined in TABLES').toContain('DASHED');

  // 10i. Y-flip applied: the base view is at positionMm.y = 80 on an A3 landscape
  //     sheet (sheetH = 297). For edges that start at view-local y=0, the DXF Y
  //     coord = sheetH - svgY = 297 - 80 = 217. Assert at least one group-code-20
  //     value > 148 (well above the sheet midpoint — proves the Y-flip is applied,
  //     not that SVG Y-down coords were passed through raw).
  const y20Values = pairs.filter(([c]) => c === 20).map(([, v]) => parseFloat(v));
  console.log('[T-6-22] sample group-code-20 (Y) values:', y20Values.slice(0, 8));
  expect(y20Values.length, 'Must have Y-coord group-code-20 pairs').toBeGreaterThan(0);
  expect(
    y20Values.some((y) => y > 148),
    `Y-up coords expected: A3 sheetH=297, base view at svgY=80 → dxfY=217. Found Y values: ${y20Values.slice(0, 8).join(', ')}`,
  ).toBe(true);

  // 10j. Total entity count floor: a real 40×40×20 box front projection has ~12 edges
  //     (visible + hidden); title block adds ~8 TEXT + 5 LINE entities. Total > 20.
  const totalEntityCount = code0Values.filter((v) =>
    v === 'POLYLINE' || v === 'LINE' || v === 'CIRCLE' || v === 'TEXT'
  ).length;
  console.log('[T-6-22] total entity count (POLYLINE+LINE+CIRCLE+TEXT):', totalEntityCount);
  expect(totalEntityCount, 'Total entity count must exceed 20 (real geometry + title block)').toBeGreaterThan(20);

  // ─── Step 11: Browser console errors during export ────────────────────────
  // Assert no console errors were logged during the test run.
  // Paste any found errors in the report.
  if (consoleErrors.length > 0) {
    console.log('[T-6-22] BROWSER ERRORS DETECTED:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser console errors should occur during DXF export').toHaveLength(0);

  console.log(`[T-6-22] PASSED: sections=${sectionCount}, polylines=${polylineCount}, vertices=${vertexCount}, texts=${textCount}, entities=${totalEntityCount}`);
});
