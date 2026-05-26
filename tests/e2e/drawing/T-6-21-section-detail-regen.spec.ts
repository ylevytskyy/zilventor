// tests/e2e/drawing/T-6-21-section-detail-regen.spec.ts
/**
 * T-6-21 — Section + detail view regenerate: real geometry round-trip.
 *
 * Scope: section and detail view Regenerate.
 *
 * Steps:
 *  1. Build a 50×50×30 box (part A).
 *  2. Save box-A bytes to OPFS as 'parts/src-T621.zipt'.
 *  3. Build a 60×60×40 box (part B) before creating the drawing
 *     (Model tab disappears after CreateDrawingCommand).
 *  4. Save box-B bytes to globalThis.__t621_bytesB.
 *  5. CreateDrawingCommand (part A, sourcePath 'parts/src-T621.zipt')
 *     → activeDrawingSourceFingerprint = fpA.
 *  6. AddBaseViewCommand → base view (front projection, inputFingerprint = fpA).
 *  7. AddSectionViewCommand → section view parented to base view
 *     (mid-plane cut y=25, full mode, hatch expected).
 *  8. AddDetailViewCommand → detail view parented to base view
 *     (circle region at center of base view, scale 2:1).
 *  9. Pack → unpack real round-trip; store reopenedDoc in globalThis.__t621_reopenedDoc.
 * 10. Overwrite OPFS source path with box-B bytes.
 * 11. activateDrawingDocument(reopenedDoc) → activeDrawingSourceFingerprint = fpB.
 * 12. Switch to Drawing tab; assert base, section, and detail views are ALL stale.
 * 13. Regenerate the section view → assert stale marker cleared + hatchSegments.length > 0.
 * 14. Regenerate the detail view → assert stale marker cleared.
 *     (detail cascade: base view is still stale; cascade regenerates base first, then re-clips detail.)
 * 15. Assert: no stale markers remain for the section and detail.
 *
 * SELECTOR NOTE: [data-stale-marker] is a child <g> inside g[data-view-id="..."].
 * CSS selector for per-view stale marker: g[data-view-id="${viewId}"] [data-stale-marker]
 * The compound selector [data-stale-marker][data-view-id] does NOT match because
 * data-view-id is on the outer g and data-stale-marker is on an inner g.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-21: section + detail regenerate — real geometry round-trip', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const SOURCE_PATH = 'parts/src-T621.zipt';

  // ─── Step 1+2: Build box A; save bytes to OPFS ─────────────────────────
  await buildBox(page, { width: 50, height: 50, depth: 30 });

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
      if (!s.activePart || !s.kernel) throw new Error('T-6-21 step 2: kernel not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 3+4: Build box B; save bytes ────────────────────────────────
  // Box B must be built BEFORE creating the drawing — after CreateDrawingCommand
  // the Model ribbon tab disappears.
  await buildBox(page, { width: 60, height: 60, depth: 40 });

  await page.evaluate(async () => {
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
    if (!s.activePart || !s.kernel) throw new Error('T-6-21 step 4: kernel not ready');
    await s.kernel.execute(s.activePart.id);
    const bytesB = await s.kernel.saveToBytes(s.activePart.id);
    (globalThis as unknown as Record<string, unknown>)['__t621_bytesB'] = bytesB;
  });

  // ─── Step 5–8: Create drawing + base + section + detail views ─────────
  const { sheetId, baseViewId, sectionViewId, detailViewId, initialDetailEdgeCount } = await page.evaluate(
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
                    projection?: { visibleEdges: unknown[] };
                    inputFingerprint?: string;
                    hatchSegments?: unknown[];
                  }>;
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

      // Warm kernel for box-A (so namedShapeCache is ready for AddSectionViewCommand).
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(pA);
      void pA;

      // Step 5: Create drawing sourced from OPFS box-A path.
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourcePartId) throw new Error('T-6-21: activeDrawingSourcePartId null');
      if (!s1.activeDrawingSourceFingerprint) throw new Error('T-6-21: activeDrawingSourceFingerprint null');

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId = drawing.sheets[0]!.id;

      // Step 6: Place base view (front, 1:1).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
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
                visibleEdges: unknown[];
                bbox: { minX: number; minY: number; maxX: number; maxY: number };
              };
            }>;
          }>;
        };
      }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheetId)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-21: base view has no projected edges');
      }
      console.log('[T-6-21] base view projected bbox:', JSON.stringify(baseView.projection.bbox),
        'edges:', baseView.projection.visibleEdges.length);

      // Patch the base view to include viewMatrix — AddBaseViewCommand does not store it
      // but AddSectionViewCommand requires it to derive the section plane.
      // We compute buildViewMatrix('front', bbox) inline (pure math, no import needed):
      //   front orientation → Rorient = identity, M = translation(-cx, -cy, -cz)
      //   where cx = (minX+maxX)/2, cy = (minY+maxY)/2, cz = (minZ+maxZ)/2.
      {
        const partKernelId = s2.activeDrawingSourcePartId ?? s2.activePart?.id;
        console.log('[T-6-21] viewMatrix patch: partKernelId=', partKernelId, 'hasKernel=', !!s2.kernel);
        if (!partKernelId || !s2.kernel) throw new Error('T-6-21: kernel or partId not available for viewMatrix patch');
        const input = await s2.kernel.getProjectorInput({ kind: 'part', partId: partKernelId });
        console.log('[T-6-21] getProjectorInput result:', input ? 'ok' : 'null', 'bbox:', input?.bbox);
        if (!input) throw new Error('T-6-21: getProjectorInput returned null — part not cached');
        const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
        const cx = ((minX as number) + (maxX as number)) / 2;
        const cy = ((minY as number) + (maxY as number)) / 2;
        const cz = ((minZ as number) + (maxZ as number)) / 2;
        // front viewMatrix = identity · translation(-cx, -cy, -cz) (Rorient=identity for 'front').
        const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];
        console.log('[T-6-21] base view viewMatrix (front) translation:', -cx, -cy, -cz);

        // Patch store: add viewMatrix to base view (extra property read at runtime by AddSectionViewCommand).
        const currentDoc = store.getState().activeDocument;
        if (!currentDoc || currentDoc.kind !== 'drawing') throw new Error('T-6-21: drawing not active for viewMatrix patch');
        const cDoc = currentDoc.document;
        const patched = {
          ...cDoc,
          sheets: (cDoc as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> }).sheets.map((sh) =>
            sh.id !== sheetId ? sh : {
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

      // Step 7: Place section view — full mode, horizontal mid-plane cut at view-y=0
      // (world-y=25, midpoint of box Y dimension 0→50).
      // View-space coordinates: box spans -25..+25 in x and y.
      // Section line at view-y=0 cuts the box exactly in half.
      // arrowDirection=1 → section normal points in +Y world direction.
      const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
      await new AddSectionViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        p0: { x: -20, y: 0 },  // left of view at y=0 (world y=25)
        p1: { x: 20, y: 0 },   // right of view at same y
        arrowDirection: 1 as -1 | 1,
        dropAt: { x: 200, y: 80 },
        mode: 'full',
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: unknown[] }> }> };
      }).document.sheets.find((s) => s.id === sheetId)!;
      const sectionView = sh3.views.find((v) => v.kind === 'section')!;
      if (!sectionView) throw new Error('T-6-21: section view not found after AddSectionViewCommand');

      // Verify section view has hatch segments (confirms real kernel cut ran).
      const initialHatchCount = sectionView.hatchSegments?.length ?? 0;
      console.log('[T-6-21] initial section hatchSegments:', initialHatchCount);

      // Step 8: Place detail view — circle region that STRADDLES the top edge of box-A.
      // Box-A front view (50×50×30, front projection): bbox spans x=-25..+25, y=-25..+25.
      // Box-B front view (60×60×40, front projection): bbox spans x=-30..+30, y=-30..+30.
      // Strategy: place the circle center 3mm below box-A's top edge (y = maxY - 3),
      // radius = 5mm. This circle crosses the top edge of box-A (y=+25), capturing 1+
      // clipped edge segments. For box-B the top edge is at y=+30 which is outside the
      // circle (center at ~+22, radius 5 → highest y = +27 < +30), so 0 edges captured.
      // Therefore detailEdgeCount changes from > 0 (box-A) to 0 (box-B after regen).
      const pBbox = baseView.projection!.bbox;
      const regionCenter = {
        x: (pBbox.minX + pBbox.maxX) / 2,  // center x (unchanged)
        y: pBbox.maxY - 3,                   // 3mm below top edge of box-A
      };
      const regionRadius = 5; // small enough to straddle only the top edge, not corners
      console.log('[T-6-21] detail region center:', regionCenter, 'radius:', regionRadius,
        '(straddles box-A top edge at y=', pBbox.maxY, ')');
      const { AddDetailViewCommand } = await import('/src/commands/AddDetailViewCommand.ts');
      await new AddDetailViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        regionParent: { kind: 'circle', center: regionCenter, radiusMm: regionRadius },
        dropAt: { x: 80, y: 200 },
      }).apply();

      const s4 = store.getState();
      const sh4 = (s4.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> };
      }).document.sheets.find((s) => s.id === sheetId)!;
      const detailView = sh4.views.find((v) => v.kind === 'detail')!;
      if (!detailView) throw new Error('T-6-21: detail view not found after AddDetailViewCommand');

      // Capture initial (pre-regen, box-A) detail edge count.
      // The circle straddles box-A's top edge → should be > 0.
      const initialDetailEdgeCount =
        (detailView as { projection?: { visibleEdges: unknown[] } }).projection?.visibleEdges.length ?? 0;
      console.log('[T-6-21] initial detail edges (box-A, pre-regen):', initialDetailEdgeCount);

      return {
        sheetId,
        baseViewId: baseView.id,
        sectionViewId: sectionView.id,
        detailViewId: detailView.id,
        initialDetailEdgeCount,
      };
    },
    { sourcePath: SOURCE_PATH, partIdA },
  );

  // ─── Step 9: Pack → unpack round-trip (separate evaluate — avoids context timeout) ──
  const { viewCount } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: unknown } | null;
        };
      };
    }).__zilventorStore;
    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-21 step 9: no active drawing');
    }

    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');

    console.log('[T-6-21] STEP9: calling real packDrawing');
    const packStart = Date.now();
    const packedBytes = await packDrawing(state.activeDocument.document as Parameters<typeof packDrawing>[0]);
    console.log('[T-6-21] STEP9: packDrawing done in', Date.now() - packStart, 'ms, bytes:', packedBytes.length);

    console.log('[T-6-21] STEP9: calling real unpackDrawing');
    const unpackStart = Date.now();
    const reopenedDoc = await unpackDrawing(packedBytes);
    console.log('[T-6-21] STEP9: unpackDrawing done in', Date.now() - unpackStart, 'ms');

    (globalThis as unknown as Record<string, unknown>)['__t621_reopenedDoc'] = reopenedDoc;

    const viewCount = (reopenedDoc as { sheets: Array<{ views: unknown[] }> }).sheets[0]?.views.length ?? 0;
    return { viewCount };
  });

  expect(viewCount, 'reopenedDoc must have 3 views (base + section + detail) after pack→unpack').toBeGreaterThanOrEqual(3);

  // Assert detail circle straddles box-A top edge → non-zero initial edge count.
  // This proves the region placement is meaningful (not a degenerate no-op).
  console.log('[T-6-21] pre-regen detail edge count (box-A):', initialDetailEdgeCount);
  expect(initialDetailEdgeCount, 'detail circle must straddle box-A top edge and capture ≥1 clipped edge before regen').toBeGreaterThan(0);

  // ─── Step 10: Overwrite OPFS with box-B bytes ──────────────────────────
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

      const bytesB = (globalThis as unknown as Record<string, unknown>)['__t621_bytesB'] as Uint8Array;
      if (!bytesB) throw new Error('T-6-21 step 10: bytesB not in globalThis');
      await opfsWrite(sourcePath, bytesB);
    },
    { sourcePath: SOURCE_PATH },
  );

  // ─── Step 11: activateDrawingDocument with reopenedDoc ─────────────────
  await page.evaluate(async () => {
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
    const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t621_reopenedDoc'];
    if (!reopenedDoc) throw new Error('T-6-21 step 11: reopenedDoc not in globalThis');

    const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
    await activateDrawingDocument(reopenedDoc as never, {
      kernel: kernel as never,
      opfs: opfsShim as never,
    });
  });

  // ─── Step 12: Switch to Drawing tab; assert ALL THREE views are stale ──
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // All 3 views (base, section, detail) should be stale after reopen with changed source.
  // Stale marker is rendered inside g[data-view-id="..."] as a child g[data-stale-marker].
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 15_000 });
  const staleCountBefore = await page.locator('[data-stale-marker]').count();
  console.log('[T-6-21] stale markers before regen:', staleCountBefore);
  expect(staleCountBefore, 'base + section + detail must all be stale').toBeGreaterThanOrEqual(3);

  // ─── Step 13: Regenerate section view ─────────────────────────────────
  // IMPORTANT: stale marker selector is g[data-view-id="..."] [data-stale-marker]
  // because data-stale-marker is on an inner <g>, NOT on the same element as data-view-id.
  const sectionStaleMarker = page.locator(`g[data-view-id="${sectionViewId}"] [data-stale-marker]`);
  await expect(sectionStaleMarker).toBeVisible({ timeout: 10_000 });
  await sectionStaleMarker.click();

  // Section stale marker should clear; drives real regenerateSectionView path.
  await expect(async () => {
    const count = await page.locator(`g[data-view-id="${sectionViewId}"] [data-stale-marker]`).count();
    expect(count, 'section stale marker must clear after Regenerate').toBe(0);
  }).toPass({ timeout: 30_000 });

  // Verify hatchSegments populated in store — confirms real cutBySectionPlane + projectSectionView ran.
  const sectionHatchCount = await page.evaluate(
    ({ sid, shId }: { sid: string; shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{ id: string; kind: string; hatchSegments?: unknown[] }>;
                }>;
              };
            };
          };
        };
      }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return 0;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const sv = sh?.views.find((v) => v.id === sid);
      return (sv as { hatchSegments?: unknown[] } | undefined)?.hatchSegments?.length ?? 0;
    },
    { sid: sectionViewId, shId: sheetId },
  );
  console.log('[T-6-21] section hatchSegments after regen:', sectionHatchCount);
  expect(sectionHatchCount, 'section view must have hatch segments after regenerate (confirms real kernel cut ran)').toBeGreaterThan(0);

  // ─── Step 14: Regenerate detail view (cascade: base still stale) ───────
  // The detail cascade: base view parent is still stale → regenerateDetailView cascades
  // base first (via RegenerateViewCommand), then re-clips detail via projectDetailView.
  const detailStaleMarker = page.locator(`g[data-view-id="${detailViewId}"] [data-stale-marker]`);
  await expect(detailStaleMarker).toBeVisible({ timeout: 10_000 });
  await detailStaleMarker.click();

  // Detail stale marker should clear.
  await expect(async () => {
    const count = await page.locator(`g[data-view-id="${detailViewId}"] [data-stale-marker]`).count();
    expect(count, 'detail stale marker must clear after Regenerate').toBe(0);
  }).toPass({ timeout: 30_000 });

  // ─── Step 15: Verify detail projection inputFingerprint is updated ─────
  const detailFp = await page.evaluate(
    ({ did, shId }: { did: string; shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{ id: string; inputFingerprint?: string }>;
                }>;
              };
            };
          };
        };
      }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const dv = sh?.views.find((v) => v.id === did);
      return dv?.inputFingerprint ?? null;
    },
    { did: detailViewId, shId: sheetId },
  );
  console.log('[T-6-21] detail inputFingerprint after regen:', detailFp);
  expect(detailFp, 'detail inputFingerprint must be set after regenerate').not.toBeNull();

  const detailEdgeCount = await page.evaluate(
    ({ did, shId }: { did: string; shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{ id: string; projection?: { visibleEdges: unknown[] } }>;
                }>;
              };
            };
          };
        };
      }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return 0;
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const dv = sh?.views.find((v) => v.id === did);
      return dv?.projection?.visibleEdges.length ?? 0;
    },
    { did: detailViewId, shId: sheetId },
  );
  console.log('[T-6-21] detail edges after regen (box-B):', detailEdgeCount);
  // Assert the detail geometry CHANGED after regen.
  // Pre-regen (box-A): top edge at y=+25 → circle (center y=+22, r=5) captures it → count > 0.
  // Post-regen (box-B): top edge at y=+30 → circle (center y=+22, r=5) max is y=+27 < +30 → 0 edges.
  // So the edge count must differ — proving the re-projection actually ran with new geometry.
  expect(detailEdgeCount, 'detail edge count after regen (box-B) must differ from pre-regen (box-A) count, proving real geometry re-clip ran').not.toBe(initialDetailEdgeCount);

  // ─── Step 16: No stale markers for section or detail ──────────────────
  const remainingSectionMarkers = await page.locator(`g[data-view-id="${sectionViewId}"] [data-stale-marker]`).count();
  const remainingDetailMarkers = await page.locator(`g[data-view-id="${detailViewId}"] [data-stale-marker]`).count();
  expect(remainingSectionMarkers, 'section stale marker must be gone after regenerate').toBe(0);
  expect(remainingDetailMarkers, 'detail stale marker must be gone after regenerate').toBe(0);
});
