// tests/e2e/drawing/T-6-4-stale-banner-regen.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T-6-4 — Stale banner appears when source geometry changes; Regenerate clears it.
 *
 * Steps:
 *   0. Build a REAL kernel-backed part (New Part + seeded sketch/extrude) so that
 *      Regenerate's projectViewFromSource → kernel.getProjectorInput finds warm geometry
 *      in the kernel's namedShapeCache. A synthetic partId injected via raw setState with
 *      no matching kernel-side part leaves the cache cold: Regenerate then throws
 *      GEOMETRY_NOT_CACHED and the stale marker never clears (this was the original,
 *      pre-existing bug in this spec — see debug notes below).
 *   1. Seed a drawing with one base view (with inputFingerprint set).
 *   2. Mutate the drawing so the view loses its inputFingerprint (simulating a source change).
 *      DrawingCanvas detects views with projection but no inputFingerprint as stale on mount.
 *   3. Trigger a re-mount by switching away and back to the drawing document.
 *   4. Assert: [data-stale-marker] is visible.
 *   5. Click the Regenerate button on the stale view.
 *   6. Assert: stale marker cleared.
 *
 * Debug notes (fix/e2e-repair): this spec used to inject a fully synthetic partId
 * ("T64-part") via `setState` with an empty featureTree and no corresponding kernel
 * part. Clicking the stale marker invoked handleRegenerate → projectViewFromSource,
 * which calls `kernel.getProjectorInput({kind:'part', partId: 'T64-part'})`. Since
 * that id was never created in the kernel (no createPart/addFeature/execute call),
 * the namedShapeCache had no entry and getProjectorInput returned null, so
 * projectViewFromSource threw `GEOMETRY_NOT_CACHED: ... partId "T64-part"`. The
 * handleRegenerate catch-block logged the error and left the view marked stale,
 * so the final `toHaveCount(0)` assertion timed out. Building a real part first
 * (mirrors the `seedKernelPart` pattern already used by model e2e specs; App.tsx's
 * activePart effect auto-executes the kernel and warms the cache) makes Regenerate
 * succeed for real, which is what this spec is actually meant to verify.
 *
 * Second bug uncovered by the fix above: DrawingCanvas has its own auto-regen effect
 * (packages/app/src/drawing/DrawingCanvas.tsx:1090-1098) that fires whenever
 * `autoRegen` (store flag, defaults true) is on and a view is in `staleViews` —
 * it calls the SAME handleRegenerate this spec clicks manually. Previously that
 * auto-attempt also failed with GEOMETRY_NOT_CACHED, so the marker stayed put and
 * the manual click always found a live target. Once Regenerate started succeeding,
 * the auto-regen effect raced ahead of the manual click and removed the stale
 * marker from the DOM first, so `page.locator('[data-stale-marker]').click()`
 * kept finding the element "detached from the DOM" and retried until the 120s
 * test timeout. This spec is specifically about the manual-click path (auto-regen
 * has its own dedicated coverage in auto-regen.spec.ts), so we disable autoRegen
 * here to remove the race — mirrors the `setAutoRegen(false)` control-test pattern
 * already used in auto-regen.spec.ts.
 */
test('T-6-4: Stale-marker visible after source change; Regenerate clears it', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Disable autoRegen so DrawingCanvas's own auto-regen effect doesn't race the
  // manual click below (see second debug note above).
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { setAutoRegen: (v: boolean) => void } };
    };
    w.__zilventorStore.getState().setAutoRegen(false);
  });

  // 0. Build a REAL kernel-backed part so Regenerate's kernel.getProjectorInput
  //    lookup succeeds (see debug notes above).
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await seedKernelPart(page, {
    parameters: [{ name: 'd1', expression: '40', value: 40, unit: 'mm' }],
    sketches: [{ id: 'S1', primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }] }],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });
  // Wait for App.tsx's activePart effect to auto-execute the kernel and warm
  // the namedShapeCache (same signal used by other seedKernelPart-based specs).
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/,
  );
  const partId = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activePart: { id: string } } };
    };
    return w.__zilventorStore.getState().activePart.id;
  });

  // 1. Seed a drawing with a base view that has NO inputFingerprint, referencing the
  //    REAL part built above.
  //    DrawingCanvas.useEffect marks views with projection && !inputFingerprint as stale on mount.
  //    We inject directly — no fingerprint means the view is stale from the start.
  await page.evaluate((partId) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: unknown };
        setState(partial: unknown): void;
      };
    };

    const sheetId = 'T64-sheet';
    const viewId = 'T64-view';
    const drawingId = 'T64-drawing';

    const drawing = {
      id: drawingId, name: 'SeedBox — Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: viewId, kind: 'base',
          positionMm: { x: 80, y: 80 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          projection: {
            visibleEdges: [{ id: `${viewId}-e0`, kind: 'outline',
              points: [[0,0],[100,0],[100,60],[0,60],[0,0]] }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
          },
          // NO inputFingerprint → DrawingCanvas will mark this view as stale on mount
        }],
        dimensions: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    const activePart = w.__zilventorStore.getState().activePart;

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart,
      activeAssembly: null,
    });

  }, partId);

  // 2. Assert: [data-stale-marker] visible on mount.
  await expect(page.locator('[data-stale-marker]')).toBeVisible({ timeout: 10_000 });

  // 3. Click the stale marker (a <g data-stale-marker> with onClick handler).
  //    ViewElement renders this as a clickable group, not a button element.
  await page.locator('[data-stale-marker]').click();

  // 4. Assert: stale marker cleared.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 10_000 });
});
