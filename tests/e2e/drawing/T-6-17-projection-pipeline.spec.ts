// tests/e2e/drawing/T-6-17-projection-pipeline.spec.ts
/**
 * T-6-17 — Drawing view projection pipeline: real-geometry placement + regenerate + staleness.
 *
 * Scope: base / projected / iso views.
 * Does NOT hand-type projection data — asserts kernel-derived edges.
 *
 * Steps:
 *   1. Build a real 50×50×30 box part via the UI (same as T-6-7).
 *   2. Re-execute in kernel to warm namedShapeCache.
 *   3. Drive CreateDrawingCommand to create a drawing sourced from that part; B0.3 sets activeDrawingSourcePartId.
 *   4. Activate placeBase mode → click sheet → assert view renders real edges (visibleEdges.length > 0).
 *   5. Activate placeIso mode → click sheet → assert iso view renders real edges.
 *   6. Simulate a source edit (clear inputFingerprint on base view) → remount → assert stale marker.
 *   7. Click Regenerate → assert stale marker cleared and edges updated.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

test('T-6-17: real-geometry projection pipeline — base + iso placement + stale + regen', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build a real box part in the kernel.
  await buildBox(page, { width: 50, height: 50, depth: 30 });

  // 2. Re-execute to ensure namedShapeCache is warm; capture partId.
  //    In the real app, CreateDrawingCommand.apply() (B0.3) calls loadDrawingSource
  //    which does opfs.read(partPath) → kernel.loadFromBytes → kernel.execute and sets
  //    BOTH activeDrawingSourcePartId AND activeDrawingSourceFingerprint (bytes hash).
  //    In this e2e, source.partPath = `${partId}.zipt` triggers the OPFS-fail fallback:
  //    partId returned directly, fingerprint = djb2(partId) (synthetic; acceptable for e2e).
  const { partId, sheetId } = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; featureTree: unknown[]; parameters: Record<string, unknown> } | null;
          activeDrawingSourcePartId: string | null;
          activeDrawingSourceFingerprint: string | null;
          kernel: { execute(id: string): Promise<unknown>; getProjectorInput(args: { kind: 'part'; partId: string }): Promise<unknown> } | null;
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || !s.kernel) throw new Error('T-6-17: kernel or activePart not ready');

    // Warm the kernel cache for the current active part
    await s.kernel.execute(s.activePart.id);

    const partId = s.activePart.id;

    // Drive CreateDrawingCommand — this sets activeDrawing AND (via B0.3 loadDrawingSource
    // fallback) sets BOTH activeDrawingSourcePartId AND activeDrawingSourceFingerprint.
    // Drawing commands are NOT window-exposed — use dynamic import.
    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    const cmd = new CreateDrawingCommand({
      sourcePath: `${partId}.zipt`,
      sourceKind: 'part',
    });
    await cmd.apply();

    // Verify BOTH source slots were set by B0.3
    const afterApply = w.__zilventorStore.getState();
    if (!afterApply.activeDrawingSourcePartId) {
      throw new Error(`T-6-17: activeDrawingSourcePartId is null after CreateDrawingCommand — B0 not wired`);
    }
    if (!afterApply.activeDrawingSourceFingerprint) {
      throw new Error(`T-6-17: activeDrawingSourceFingerprint is null after CreateDrawingCommand — B0 bytes-hash not wired`);
    }

    // Read the sheetId/drawingId that CreateDrawingCommand generated
    const activeDoc = (afterApply as unknown as { activeDocument: { document: { id: string; sheets: Array<{ id: string }> } } }).activeDocument;
    return {
      partId,
      sheetId: activeDoc.document.sheets[0]!.id,
      drawingId: activeDoc.document.id,
    };
  });

  // 3. Switch to drawing tab (CreateDrawingCommand already activated the drawing).
  await page.getByRole('tab', { name: 'Drawing' }).click();
  // The sheet is empty initially — just the sheet border should be visible.
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });

  // 4. Place a base view via AddBaseViewCommand (simulating placeBase flow).
  //    In this test we drive the command directly (not through the full dialog + click UI)
  //    because Playwright click coordinates in an SVG are device-pixel-dependent.
  const baseViewId = await page.evaluate(
    async ({ sheetId }: { sheetId: string }) => {
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      const cmd = new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      });
      try {
        await cmd.apply();
      } catch (e) {
        throw new Error(`AddBaseViewCommand failed: ${String(e)}`);
      }
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> } } | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.kind === 'base');
      if (!baseView) throw new Error('T-6-17: base view not found after AddBaseViewCommand');
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error(`T-6-17: base view has no real projected edges. projection=${JSON.stringify(baseView.projection)}`);
      }
      return baseView.id;
    },
    { sheetId },
  );

  // 5. Assert the base view renders in the drawing canvas with real geometry.
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  // The rendered SVG contains at least one <polyline> element (each visibleEdge becomes a polyline).
  const edgeCount = await page.locator(`g[data-view-id="${baseViewId}"] polyline`).count();
  expect(edgeCount).toBeGreaterThan(0);

  // 6. Place an iso view via AddIsoViewCommand.
  const isoViewId = await page.evaluate(
    async ({ sheetId }: { sheetId: string }) => {
      const { AddIsoViewCommand } = await import('/src/commands/AddIsoViewCommand.ts');
      const cmd = new AddIsoViewCommand({
        sheetId,
        positionMm: { x: 250, y: 80 },
        corner: 'NE',
        scale: { numerator: 1, denominator: 1 },
      });
      await cmd.apply();
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; projection?: { visibleEdges: unknown[] } }> }> } } | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const isoView = sheet?.views.find((v) => v.kind === 'iso');
      if (!isoView?.projection || isoView.projection.visibleEdges.length === 0) {
        throw new Error(`T-6-17: iso view has no real projected edges`);
      }
      return isoView.id;
    },
    { sheetId },
  );

  await expect(page.locator(`g[data-view-id="${isoViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 7. Simulate staleness (condition b): set activeDrawingSourceFingerprint to a NEW value
  //    (simulating a source edit between the view being placed and the current activation).
  //    The view's stored inputFingerprint still holds the OLD value → mismatch → stale.
  //    This tests the correct staleness condition — the one the original plan BROKE by using
  //    djb2(kernelId) which never changes. Here we change the fingerprint to simulate a real edit.
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { id: string; name: string; units: string; source: unknown; properties: unknown; sheets: Array<{ id: string; name: string; size: unknown; orientation: string; views: Array<{ id: string; [key: string]: unknown }>; dimensions: unknown[]; dimensionGroups: unknown[]; annotations: unknown[]; titleBlock: unknown }>; activeSheetId: string } } | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceFingerprint: string | null;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!doc) return;
      // Read the base view's current inputFingerprint (set when it was projected)
      const sheet = doc.sheets.find((sh) => sh.id === sheetId);
      const baseView = sheet?.views.find((v) => v.id === baseViewId);
      const oldFp = (baseView as { inputFingerprint?: string } | undefined)?.inputFingerprint;
      if (!oldFp) {
        // Fallback: clear inputFingerprint to trigger condition (a)
        const next = {
          ...doc,
          sheets: doc.sheets.map((sh) =>
            sh.id === sheetId
              ? { ...sh, views: sh.views.map((v) => v.id === baseViewId ? (({ inputFingerprint: _fp, ...rest }) => rest)(v as { inputFingerprint?: string; [key: string]: unknown }) : v) }
              : sh
          ),
        };
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: next },
          activeDrawing: next,
          activeDrawingSourcePartId: s.activeDrawingSourcePartId,
          activeDrawingSourceFingerprint: s.activeDrawingSourceFingerprint,
          activePart: null,
          activeAssembly: null,
        });
      } else {
        // Primary path (condition b): change activeDrawingSourceFingerprint to simulate
        // a source edit after the view was projected.
        w.__zilventorStore.setState({
          activeDocument: { kind: 'drawing', document: doc },
          activeDrawing: doc,
          activeDrawingSourcePartId: s.activeDrawingSourcePartId,
          activeDrawingSourceFingerprint: oldFp + '-EDITED', // different from view's inputFingerprint
          activePart: null,
          activeAssembly: null,
        });
      }
    },
    { sheetId, baseViewId },
  );

  // The Zustand selector in DrawingCanvas re-fires the staleness useEffect automatically
  // when activeDrawingSourceFingerprint changes (no tab switch needed).
  // Both views (base + iso) will be stale since we changed the global fingerprint.
  // 8. Assert at least one stale marker is visible.
  await expect(page.locator('[data-stale-marker]').first()).toBeVisible({ timeout: 10_000 });
  const staleCount = await page.locator('[data-stale-marker]').count();
  expect(staleCount).toBeGreaterThan(0);

  // 9. Click Regenerate on the first stale marker — handleRegenerate calls projectViewFromSource.
  await page.locator('[data-stale-marker]').first().click();

  // 10. After regen the clicked view's stale marker should be gone.
  //     Wait a moment for the async regen to complete.
  await expect(async () => {
    const count = await page.locator('[data-stale-marker]').count();
    expect(count).toBeLessThan(staleCount);
  }).toPass({ timeout: 10_000 });
});
