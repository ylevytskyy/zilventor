// tests/e2e/drawing/T-6-26-dxf-native-dim.spec.ts
/**
 * T-6-26 — DXF native DIMENSION entities: real-environment parse-back.
 *
 * Steps:
 *  1. Build a 40×40×20 box part via the UI (real kernel geometry).
 *  2. Save part bytes to OPFS as 'parts/src-T626.zipt'.
 *  3. CreateDrawingCommand (sourced from the box).
 *  4. AddBaseViewCommand → base view (front projection, 1:1, real OCCT edges).
 *  5. AddDrawingDimensionCommand → linear-h dim on base view.
 *  6. Restore activePart in store (CreateDrawingCommand nulls it) so the
 *     "Export DXF" ribbon button is enabled.
 *  7. Switch to Drawing tab.
 *  8. Stub window.showSaveFilePicker = undefined → triggerDownload anchor-click path.
 *  9. Click "Export DXF" button; capture download.
 * 10. Read downloaded bytes as UTF-8 text.
 * 11. Parse DXF group-code pairs and assert native DIMENSION entities:
 *     a. 4 balanced SECTION/ENDSEC pairs (BLOCKS now non-empty)
 *     b. DIMSTYLE table with STANDARD style
 *     c. ≥1 DIMENSION entity on DIMENSIONS layer
 *     d. ≥1 anonymous *D block defined
 *     e. Every DIMENSION block ref resolves to a defined BLOCK
 *     f. No console errors
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

test('T-6-26: DXF native DIMENSION entities — real geometry download + parse-back', async ({ page }) => {
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

  const SOURCE_PATH = 'parts/src-T626.zipt';

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
      if (!s.activePart || !s.kernel) throw new Error('T-6-26 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Steps 3–5: Create drawing + base view + linear-h dimension ──────────
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
                  dimensions: unknown[];
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

      // Warm kernel cache for the box (so projector can load it).
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);

      // Step 3: Create drawing sourced from OPFS box path.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-26: activeDrawingSourcePartId null');
      if (!s1.activeDrawingSourceFingerprint) throw new Error('T-6-26: activeDrawingSourceFingerprint null');

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId2 = drawing.sheets[0]!.id;

      // Step 4: Add base view with real projection.
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
        throw new Error('T-6-26: base view has no projected edges — kernel projection failed');
      }
      console.log('[T-6-26] base view projected edges:', baseView.projection.visibleEdges.length,
        'hidden:', baseView.projection.hiddenEdges.length);

      // Step 5: Add a linear-h dimension to the base view.
      const visEdges = baseView.projection.visibleEdges;
      if (visEdges.length < 2) throw new Error('T-6-26: not enough visible edges for dimension');
      const dimFrom = { kind: 'edge-endpoint', edgeId: visEdges[0]!.id, end: 'start' };
      const dimTo   = { kind: 'edge-endpoint', edgeId: visEdges[1]!.id, end: 'start' };
      const { AddDrawingDimensionCommand } = await import('/src/commands/AddDrawingDimensionCommand.ts');
      await new AddDrawingDimensionCommand({
        sheetId: sheetId2,
        dim: {
          id: 'dim-t626-h1',
          kind: 'linear-h',
          viewId: baseView.id,
          from: dimFrom as { kind: 'edge-endpoint'; edgeId: string; end: 'start' | 'end' },
          to:   dimTo   as { kind: 'edge-endpoint'; edgeId: string; end: 'start' | 'end' },
          offsetMm: 15,
          textOverride: null,
          sourceParameterName: null,
        },
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as {
        document: { sheets: Array<{ id: string; dimensions: unknown[] }> };
      }).document.sheets.find((s) => s.id === sheetId2)!;
      console.log('[T-6-26] dimensions on sheet:', sh3.dimensions.length);

      return { sheetId: sheetId2 };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  // ─── Step 6: Restore activePart in store ──────────────────────────────────
  await page.evaluate(
    async ({ pA }: { pA: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          setState(partial: unknown): void;
        };
      }).__zilventorStore;

      const stubPart = {
        id: pA,
        name: 'src-T626',
        units: 'mm',
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
        hardware: [],
      };

      store.setState({ activePart: stubPart });
      console.log('[T-6-26] activePart restored in store, id=', pA);
    },
    { pA: partIdA },
  );

  // ─── Step 7: Switch to Drawing tab ────────────────────────────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // ─── Step 8: Stub showSaveFilePicker so anchor-click fallback fires ───────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  // ─── Step 9: Click Export DXF + capture download ──────────────────────────
  const exportBtn = page.getByRole('button', { name: /^Export DXF$/ });
  await expect(exportBtn).toBeEnabled({ timeout: 5_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportBtn.click();
  const download = await downloadPromise;

  // Verify suggested filename ends with .dxf
  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  console.log('[T-6-26] download filename:', download.suggestedFilename());

  // ─── Step 10: Read DXF content ────────────────────────────────────────────
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const dxfText = fs.readFileSync(downloadPath!, 'utf-8');

  console.log('[T-6-26] DXF length:', dxfText.length, 'chars');

  // Non-trivial size guard
  expect(dxfText.length, 'DXF output must be non-trivially long (>500 chars)').toBeGreaterThan(500);

  // ─── Step 11: Parse and assert native DIMENSION structure ────────────────
  const pairs = parseDxf(dxfText);
  expect(pairs.length, 'DXF must parse to >10 group-code pairs').toBeGreaterThan(10);

  // ─── Native DIMENSION assertions ─────────────────────────────────────────
  const code0Values = pairs.filter(([c]) => c === 0).map(([, v]) => v);

  // 4 sections still (HEADER, TABLES, BLOCKS, ENTITIES) — BLOCKS now non-empty
  expect(code0Values.filter((v) => v === 'SECTION').length).toBe(4);
  expect(code0Values.filter((v) => v === 'ENDSEC').length).toBe(4);

  // DIMSTYLE table present
  expect(dxfText, 'DIMSTYLE table must be defined').toContain('DIMSTYLE');
  expect(dxfText, 'STANDARD dim style').toContain('STANDARD');

  // ≥1 DIMENSION entity on the DIMENSIONS layer
  let dimEntityCount = 0;
  const dimBlockNames: string[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'DIMENSION') {
      let layer = ''; let blk = '';
      for (let j = i + 1; j < Math.min(i + 12, pairs.length); j++) {
        if (pairs[j]![0] === 0) break;
        if (pairs[j]![0] === 8) layer = pairs[j]![1];
        if (pairs[j]![0] === 2) blk = pairs[j]![1];
      }
      if (layer === 'DIMENSIONS') { dimEntityCount++; if (blk) dimBlockNames.push(blk); }
    }
  }
  console.log('[T-6-26] DIMENSION entities on DIMENSIONS:', dimEntityCount, 'block refs:', dimBlockNames);
  expect(dimEntityCount, 'Must emit ≥1 native DIMENSION entity on DIMENSIONS layer').toBeGreaterThan(0);

  // ≥1 anonymous *D block defined, and the DIMENSION's block ref resolves to a defined BLOCK
  const blockNamesDefined: string[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'BLOCK') {
      for (let j = i + 1; j < Math.min(i + 8, pairs.length); j++) {
        if (pairs[j]![0] === 2) { blockNamesDefined.push(pairs[j]![1]); break; }
      }
    }
  }
  console.log('[T-6-26] BLOCK defs:', blockNamesDefined);
  expect(blockNamesDefined.some((n) => /^\*D\d+$/.test(n)), 'Must define ≥1 anonymous *D block').toBe(true);
  expect(dimBlockNames.every((ref) => blockNamesDefined.includes(ref)),
    `Every DIMENSION block ref must resolve to a defined BLOCK. refs=${dimBlockNames} defined=${blockNamesDefined}`).toBe(true);

  // No console errors during export
  expect(consoleErrors, 'No browser console errors during native-dim DXF export').toHaveLength(0);
  console.log(`[T-6-26] PASSED: dimEntities=${dimEntityCount}, blocks=${blockNamesDefined.length}`);

  void sheetId; // used via store read above
});
