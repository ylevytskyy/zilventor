// tests/e2e/drawing/T-6-22-dxf-export.spec.ts
/**
 * T-6-22 — DXF export: real-environment download round-trip.
 *
 * Steps:
 *  1. Build a 40×40×20 box part via the UI (real kernel geometry).
 *  2. Save part bytes to OPFS as 'parts/src-T622.zipt'.
 *  3. CreateDrawingCommand (sourced from the box).
 *  4. AddBaseViewCommand → base view (front projection, 1:1, real OCCT edges).
 *  5. AddSectionViewCommand → full mid-plane cut (hatch → SECTION-HATCH LINE entities).
 *  6. AddDetailViewCommand → circle sub-region of base view (border → DETAIL CIRCLE entity).
 *  7. AddDrawingDimensionCommand → linear-h dim on base view (→ DIMENSIONS POLYLINE+TEXT).
 *  8. Restore activePart in store (CreateDrawingCommand nulls it) so the
 *     "Export DXF" ribbon button is enabled.
 *  9. Switch to Drawing tab.
 * 10. Stub window.showSaveFilePicker = undefined → triggerDownload falls through
 *     to the anchor-click path which Playwright captures as a 'download' event.
 * 11. Click "Export DXF" button; capture download.
 * 12. Read downloaded bytes as UTF-8 text.
 * 13. Parse DXF group-code pairs and assert:
 *     a. SECTION/ENDSEC pairs balanced
 *     b. HEADER, TABLES, ENTITIES sections present
 *     c. EOF terminator present
 *     d. VISIBLE layer appears (in LAYER table entry)
 *     e. At least one POLYLINE entity on VISIBLE layer
 *     f. At least one VERTEX entity
 *     g. At least one TEXT entity (title block)
 *     h. DASHED ltype defined (for HIDDEN layer)
 *     i. Y-flip applied (at least one group-code-20 Y > sheetH/2 = 148.5)
 *     j. Total entity count exceeds a floor (non-trivial output)
 *     k. SECTION-HATCH: at least one LINE entity on SECTION-HATCH layer
 *     l. DETAIL: at least one CIRCLE entity on DETAIL layer
 *     m. DIMENSIONS: at least one POLYLINE on DIMENSIONS layer
 *     n. GAP 2 — vertex parity: DXF VERTEX count equals sum of edge.points.length
 *        across all views' visible+hidden edges (1:1, no amplification)
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

  // ─── Steps 3–7: Create drawing + base + section + detail + dimension ──────
  const { sheetId, viewCount, projectionPointSum, sectionViewId, detailViewId } = await page.evaluate(
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
                    hatchSegments?: unknown[];
                    inputFingerprint?: string;
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
              getProjectorInput(args: { kind: string; partId: string }): Promise<{ bbox: readonly number[] } | null>;
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
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-22: activeDrawingSourcePartId null');
      if (!s1.activeDrawingSourceFingerprint) throw new Error('T-6-22: activeDrawingSourceFingerprint null');

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
        throw new Error('T-6-22: base view has no projected edges — kernel projection failed');
      }
      console.log('[T-6-22] base view projected edges:', baseView.projection.visibleEdges.length,
        'hidden:', baseView.projection.hiddenEdges.length);

      // Step 5: Patch base view with viewMatrix (required by AddSectionViewCommand).
      // Same approach as T-6-21 — front orientation → identity rotation, center-of-bbox translation.
      {
        const partKernelId = s2.activeDrawingSourcePartId ?? s2.activePart?.id;
        if (!partKernelId || !s2.kernel) throw new Error('T-6-22: kernel or partId not available for viewMatrix patch');
        const input = await s2.kernel.getProjectorInput({ kind: 'part', partId: partKernelId });
        if (!input) throw new Error('T-6-22: getProjectorInput returned null — part not cached');
        const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
        const cx = ((minX as number) + (maxX as number)) / 2;
        const cy = ((minY as number) + (maxY as number)) / 2;
        const cz = ((minZ as number) + (maxZ as number)) / 2;
        // front viewMatrix = identity · translation(-cx, -cy, -cz)
        const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];
        console.log('[T-6-22] viewMatrix translation:', -cx, -cy, -cz);

        const currentDoc = store.getState().activeDocument;
        if (!currentDoc || currentDoc.kind !== 'drawing') throw new Error('T-6-22: drawing not active for viewMatrix patch');
        const cDoc = currentDoc.document;
        const patched = {
          ...cDoc,
          sheets: (cDoc as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> }).sheets.map((sh) =>
            sh.id !== sheetId2 ? sh : {
              ...sh,
              views: sh.views.map((v) =>
                (v as { id: string })['id'] !== baseView.id ? v : { ...v, viewMatrix: vm }
              ),
            }
          ),
        };
        store.setState({
          activeDocument: { kind: 'drawing', document: patched },
          activeDrawing: patched,
        });
      }

      // Step 6: Add section view — full mode, horizontal mid-plane cut.
      // Box spans 0..40 in x+y, so mid-plane is at world-y=20.
      // In view-space (front), box is centered: spans -20..+20 in x and y.
      // Section line at view-y=0 cuts exactly in half → 40mm×40mm cut face → hatch segments.
      const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
      await new AddSectionViewCommand({
        drawingId: drawing.id,
        sheetId: sheetId2,
        parentViewId: baseView.id,
        p0: { x: -15, y: 0 },
        p1: { x: 15, y: 0 },
        arrowDirection: 1 as -1 | 1,
        dropAt: { x: 200, y: 80 },
        mode: 'full',
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as {
        document: {
          sheets: Array<{
            id: string;
            views: Array<{ id: string; kind: string; hatchSegments?: unknown[] }>;
          }>;
        };
      }).document.sheets.find((s) => s.id === sheetId2)!;
      const sectionView = sh3.views.find((v) => v.kind === 'section')!;
      if (!sectionView) throw new Error('T-6-22: section view not found after AddSectionViewCommand');
      const initialHatchCount = sectionView.hatchSegments?.length ?? 0;
      console.log('[T-6-22] section hatchSegments:', initialHatchCount);
      if (initialHatchCount === 0) throw new Error('T-6-22: section view has no hatch segments — kernel cut failed');

      // Step 7: Add detail view — circle region in center of base view bbox.
      const pBbox = baseView.projection!.bbox;
      const detailCenter = {
        x: (pBbox.minX + pBbox.maxX) / 2,
        y: (pBbox.minY + pBbox.maxY) / 2,
      };
      const detailRadius = 8;
      console.log('[T-6-22] detail region center:', detailCenter, 'radius:', detailRadius);
      const { AddDetailViewCommand } = await import('/src/commands/AddDetailViewCommand.ts');
      await new AddDetailViewCommand({
        drawingId: drawing.id,
        sheetId: sheetId2,
        parentViewId: baseView.id,
        regionParent: { kind: 'circle', center: detailCenter, radiusMm: detailRadius },
        dropAt: { x: 80, y: 200 },
      }).apply();

      const s4 = store.getState();
      const sh4 = (s4.activeDocument as {
        document: {
          sheets: Array<{
            id: string;
            views: Array<{ id: string; kind: string }>;
          }>;
        };
      }).document.sheets.find((s) => s.id === sheetId2)!;
      const detailView = sh4.views.find((v) => v.kind === 'detail')!;
      if (!detailView) throw new Error('T-6-22: detail view not found after AddDetailViewCommand');
      console.log('[T-6-22] detail view id:', detailView.id);

      // Step 8: Add a linear-h dimension to the base view.
      // Use the first two visible edge IDs (their start endpoints) as from/to refs.
      const visEdges = baseView.projection!.visibleEdges;
      if (visEdges.length < 2) throw new Error('T-6-22: not enough visible edges for dimension');
      const dimFrom = { kind: 'edge-endpoint', edgeId: visEdges[0]!.id, end: 'start' };
      const dimTo   = { kind: 'edge-endpoint', edgeId: visEdges[1]!.id, end: 'start' };
      const { AddDrawingDimensionCommand } = await import('/src/commands/AddDrawingDimensionCommand.ts');
      await new AddDrawingDimensionCommand({
        sheetId: sheetId2,
        dim: {
          id: 'dim-t622-h1',
          kind: 'linear-h',
          viewId: baseView.id,
          from: dimFrom as { kind: 'edge-endpoint'; edgeId: string; end: 'start' | 'end' },
          to:   dimTo   as { kind: 'edge-endpoint'; edgeId: string; end: 'start' | 'end' },
          offsetMm: 15,
          textOverride: null,
          sourceParameterName: null,
        },
      }).apply();

      const s5 = store.getState();
      const sh5 = (s5.activeDocument as {
        document: { sheets: Array<{ id: string; dimensions: unknown[]; views: Array<{ id: string; kind: string; projection?: { visibleEdges: Array<{ points: Array<readonly [number, number]> }>; hiddenEdges: Array<{ points: Array<readonly [number, number]> }> } }> }> };
      }).document.sheets.find((s) => s.id === sheetId2)!;
      console.log('[T-6-22] dimensions on sheet:', sh5.dimensions.length);

      // Compute expected vertex count = sum of edge.points.length across ALL views.
      // This proves the DXF VERTEX count is a 1:1 mapping (no amplification).
      let projectionPointSum = 0;
      for (const view of sh5.views) {
        if (!view.projection) continue;
        for (const e of view.projection.visibleEdges) projectionPointSum += e.points.length;
        for (const e of view.projection.hiddenEdges) projectionPointSum += e.points.length;
      }
      console.log('[T-6-22] projection point sum (expected VERTEX count):', projectionPointSum);

      return {
        sheetId: sheetId2,
        viewCount: sh5.views.length,
        projectionPointSum,
        sectionViewId: sectionView.id,
        detailViewId: detailView.id,
      };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  expect(viewCount, 'drawing must have base + section + detail views (≥3) after setup').toBeGreaterThanOrEqual(3);

  // ─── Step 8: Restore activePart in store ──────────────────────────────────
  // CreateDrawingCommand calls setActiveDocument({ kind:'drawing', ... }) which
  // sets activePart: null. The "Export DXF" button reads `source = activePart ?? activeAssembly`
  // and is disabled when both are null. Restore activePart so the button is enabled.
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

  // ─── Step 9: Switch to Drawing tab ────────────────────────────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // ─── Step 10: Stub showSaveFilePicker so anchor-click fallback fires ───────
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  // ─── Step 11: Click Export DXF + capture download ─────────────────────────
  // exact:true — "Export DXF" is a substring of "Export DXF (1:1)" (superstring-label trap);
  // unanchored name matches both buttons → strict-mode violation. Anchor to the base button.
  const exportBtn = page.getByRole('button', { name: 'Export DXF', exact: true });
  await expect(exportBtn).toBeEnabled({ timeout: 5_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await exportBtn.click();
  const download = await downloadPromise;

  // Verify suggested filename ends with .dxf
  expect(download.suggestedFilename()).toMatch(/\.dxf$/);
  console.log('[T-6-22] download filename:', download.suggestedFilename());

  // ─── Step 12: Read DXF content ────────────────────────────────────────────
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const dxfText = fs.readFileSync(downloadPath!, 'utf-8');

  console.log('[T-6-22] DXF length:', dxfText.length, 'chars');

  // Non-trivial size guard
  expect(dxfText.length, 'DXF output must be non-trivially long (>500 chars)').toBeGreaterThan(500);

  // ─── Step 13: Parse and assert DXF structure ──────────────────────────────
  const pairs = parseDxf(dxfText);
  expect(pairs.length, 'DXF must parse to >10 group-code pairs').toBeGreaterThan(10);

  const code0Values = pairs.filter(([c]) => c === 0).map(([, v]) => v);

  // 13a. SECTION / ENDSEC balanced
  const sectionCount = code0Values.filter((v) => v === 'SECTION').length;
  const endsecCount  = code0Values.filter((v) => v === 'ENDSEC').length;
  expect(sectionCount, 'SECTION count must equal ENDSEC count').toBe(endsecCount);
  expect(sectionCount, 'Must have exactly 4 sections (HEADER, TABLES, BLOCKS, ENTITIES)').toBe(4);

  // 13b. Required section names present
  expect(dxfText, 'HEADER section').toContain('HEADER');
  expect(dxfText, 'TABLES section').toContain('TABLES');
  expect(dxfText, 'ENTITIES section').toContain('ENTITIES');

  // 13c. EOF terminator (exactly one)
  const eofCount = code0Values.filter((v) => v === 'EOF').length;
  expect(eofCount, 'EOF group-code pair must be present exactly once').toBe(1);

  // 13d. VISIBLE layer defined in LAYER table
  expect(dxfText, 'VISIBLE layer must be defined').toContain('VISIBLE');

  // 13e. At least one POLYLINE entity on the VISIBLE layer.
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
  const polylineCount = code0Values.filter((v) => v === 'POLYLINE').length;
  console.log('[T-6-22] total POLYLINE count:', polylineCount, '| VISIBLE-layer POLYLINEs:', visiblePolylineCount);
  expect(polylineCount, 'At least one POLYLINE entity required (any layer)').toBeGreaterThan(0);
  expect(visiblePolylineCount, 'At least one POLYLINE on VISIBLE layer required (real projected edges)').toBeGreaterThan(0);

  // 13f. At least one VERTEX (POLYLINE body)
  const vertexCount = code0Values.filter((v) => v === 'VERTEX').length;
  console.log('[T-6-22] VERTEX count:', vertexCount);
  expect(vertexCount, 'At least one VERTEX required').toBeGreaterThan(0);

  // 13g. At least one TEXT entity (title block emits ≥8 TEXT entities)
  const textCount = code0Values.filter((v) => v === 'TEXT').length;
  console.log('[T-6-22] TEXT count:', textCount);
  expect(textCount, 'At least 8 TEXT entities required (title block)').toBeGreaterThanOrEqual(8);

  // 13h. DASHED ltype defined (for HIDDEN layer)
  expect(dxfText, 'DASHED ltype must be defined in TABLES').toContain('DASHED');

  // 13i. Y-flip applied
  const y20Values = pairs.filter(([c]) => c === 20).map(([, v]) => parseFloat(v));
  console.log('[T-6-22] sample group-code-20 (Y) values:', y20Values.slice(0, 8));
  expect(y20Values.length, 'Must have Y-coord group-code-20 pairs').toBeGreaterThan(0);
  expect(
    y20Values.some((y) => y > 148),
    `Y-up coords expected: A3 sheetH=297, base view at svgY=80 → dxfY=217. Found Y values: ${y20Values.slice(0, 8).join(', ')}`,
  ).toBe(true);

  // 13j. Total entity count floor
  const totalEntityCount = code0Values.filter((v) =>
    v === 'POLYLINE' || v === 'LINE' || v === 'CIRCLE' || v === 'TEXT'
  ).length;
  console.log('[T-6-22] total entity count (POLYLINE+LINE+CIRCLE+TEXT):', totalEntityCount);
  expect(totalEntityCount, 'Total entity count must exceed 20 (real geometry + title block)').toBeGreaterThan(20);

  // ─── 13k. SECTION-HATCH: at least one LINE on SECTION-HATCH layer ─────────
  // hatchSegments are emitted as LINE entities (not POLYLINE) in renderDrawingDxf.ts:
  //   doc.line('SECTION-HATCH', tx(h.p0.x), ty(h.p0.y), tx(h.p1.x), ty(h.p1.y))
  // Count LINE entities immediately followed by group-code-8 = SECTION-HATCH.
  let sectionHatchLineCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'LINE') {
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'SECTION-HATCH') sectionHatchLineCount++;
          break;
        }
      }
    }
  }
  console.log('[T-6-22] SECTION-HATCH LINE count:', sectionHatchLineCount);
  expect(sectionHatchLineCount, 'Must have ≥1 LINE entity on SECTION-HATCH layer (proves hatch emission from kernel cut ran)').toBeGreaterThan(0);
  void sectionViewId; // used above via store read

  // ─── 13l. DETAIL: at least one CIRCLE on DETAIL layer ────────────────────
  // Detail view with a circle region emits a CIRCLE entity on the DETAIL layer.
  // Callout on parent view also emits CIRCLE + TEXT on DETAIL layer.
  let detailCircleCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'CIRCLE') {
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'DETAIL') detailCircleCount++;
          break;
        }
      }
    }
  }
  console.log('[T-6-22] DETAIL CIRCLE count:', detailCircleCount);
  expect(detailCircleCount, 'Must have ≥1 CIRCLE entity on DETAIL layer (proves detail view emitted)').toBeGreaterThan(0);
  void detailViewId; // used above via store read

  // ─── 13m. DIMENSIONS: at least one POLYLINE on DIMENSIONS layer ───────────
  let dimensionsPolylineCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'POLYLINE') {
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'DIMENSIONS') dimensionsPolylineCount++;
          break;
        }
      }
    }
  }
  console.log('[T-6-22] DIMENSIONS POLYLINE count:', dimensionsPolylineCount);
  expect(dimensionsPolylineCount, 'Must have ≥1 POLYLINE on DIMENSIONS layer (proves dimension emitted)').toBeGreaterThan(0);

  // ─── 13n. GAP 2 — Vertex parity: VISIBLE+HIDDEN VERTEX count must equal projection point sum ──
  // emitView maps each edge.points entry 1:1 to one VERTEX entity on that edge's layer
  // (VISIBLE or HIDDEN). Other layers (DIMENSIONS, DETAIL, HOLE-TABLE) also use POLYLINE
  // entities and contribute their own VERTEXes — those are NOT in projectionPointSum.
  // We count only VERTEXes tagged layer=VISIBLE or HIDDEN and compare to projectionPointSum.
  // KNOWN: a straight box edge is tessellated into ~159–321 points by the OCCT tessellator
  // (density is the projection's own, shared with SVG renderer — not a DXF renderer bug).
  let projLayerVertexCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'VERTEX') {
      // VERTEX entity: next group-code-8 is its layer
      for (let j = i + 1; j < Math.min(i + 5, pairs.length); j++) {
        if (pairs[j]![0] === 8) {
          if (pairs[j]![1] === 'VISIBLE' || pairs[j]![1] === 'HIDDEN') projLayerVertexCount++;
          break;
        }
      }
    }
  }
  console.log('[T-6-22] vertex parity: VISIBLE+HIDDEN VERTEXes=', projLayerVertexCount, 'projection pts sum=', projectionPointSum);
  expect(projLayerVertexCount, `VISIBLE+HIDDEN VERTEX count must equal sum of edge.points.length across all views (1:1 mapping, no amplification). projection sum=${projectionPointSum}`).toBe(projectionPointSum);

  // ─── Step 14: Browser console errors during export ───────────────────────
  if (consoleErrors.length > 0) {
    console.log('[T-6-22] BROWSER ERRORS DETECTED:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser console errors should occur during DXF export').toHaveLength(0);

  console.log(`[T-6-22] PASSED: sections=${sectionCount}, polylines=${polylineCount}, vertices=${vertexCount}, texts=${textCount}, entities=${totalEntityCount}, sectionHatchLines=${sectionHatchLineCount}, detailCircles=${detailCircleCount}, dimPolylines=${dimensionsPolylineCount}`);
});
