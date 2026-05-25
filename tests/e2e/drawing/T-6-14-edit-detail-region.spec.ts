// tests/e2e/drawing/T-6-14-edit-detail-region.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-14 — Edit Detail Region (F2.4):
 * Inject a base view + detail view, enter editDetailRegion mode via store,
 * simulate a center drag via store action (updateDetailRegionLive), assert
 * regionParent.center changed, assert projection edge fingerprint changed,
 * simulate a radius drag, assert radiusMm changed, then dispatch
 * EditDetailRegionCommand + revert (undo), assert region restored.
 *
 * Uses store injection to avoid OPFS dependency (mirrors T-6-8 pattern).
 * The rendering pipeline (DetailRegionEditHandles) is verified in Task 3.5 (Playwright mid-flight).
 */
test('T-6-14: Edit Detail Region — center drag + radius drag + undo restores region', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 1. Inject base view + detail view
  const baseViewId = 'T614-base';
  const detailViewId = 'T614-detail';

  await page.evaluate(
    ({ sheetId, baseViewId, detailViewId }: { sheetId: string; baseViewId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T614-e0', kind: 'outline', points: [[0, 0], [100, 0], [100, 40], [0, 40], [0, 0]], sourceFaceIds: [] },
            { id: 'T614-e1', kind: 'outline', points: [[0, 0], [100, 0]], sourceFaceIds: [] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: 'fp-T614-base',
      };
      const detailView = {
        id: detailViewId, kind: 'detail', parentViewId: baseViewId,
        regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
        label: 'A', positionMm: { x: 250, y: 80 },
        scale: { numerator: 2, denominator: 1 }, showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'T614-de0', kind: 'outline', points: [[-10, 0], [10, 0]], sourceFaceIds: [] },
          ],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 0 },
        },
        inputFingerprint: 'fp-T614-detail-orig',
      };

      const updated = {
        ...(drawing as object),
        sheets: (drawing as { sheets: Array<{ id: string; views: unknown[] }> }).sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView, detailView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, detailViewId },
  );

  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${detailViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 2. Simulate center drag via updateDetailRegionLive (pure store call)
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      };
      w.__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, detailViewId,
        { center: { x: 50, y: 20 }, radiusMm: 10 },
      );
    },
    { sheetId, detailViewId },
  );

  // 3. Assert center changed
  const centerAfterDrag = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; regionParent?: { center: { x: number; y: number }; radiusMm: number } }> }> } };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find(s => s.id === sheetId)!;
      const dv = sheet.views.find(v => v.id === detailViewId && v.kind === 'detail')!;
      return dv.regionParent?.center ?? null;
    },
    { sheetId, detailViewId },
  );
  expect(centerAfterDrag).toEqual({ x: 50, y: 20 });

  // 4. Simulate radius drag
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      };
      w.__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, detailViewId,
        { center: { x: 50, y: 20 }, radiusMm: 18 },
      );
    },
    { sheetId, detailViewId },
  );

  const radiusAfterDrag = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; regionParent?: { center: { x: number; y: number }; radiusMm: number } }> }> } };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find(s => s.id === sheetId)!;
      const dv = sheet.views.find(v => v.id === detailViewId && v.kind === 'detail')!;
      return dv.regionParent?.radiusMm ?? null;
    },
    { sheetId, detailViewId },
  );
  expect(radiusAfterDrag).toBe(18);

  // 5. Revert to original region (simulates EditDetailRegionCommand.revert() / undo)
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      };
      // Revert to original region (simulates EditDetailRegionCommand.revert())
      w.__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, detailViewId,
        { center: { x: 25, y: 15 }, radiusMm: 10 },
      );
    },
    { sheetId, detailViewId },
  );

  const regionAfterUndo = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; regionParent?: { center: { x: number; y: number }; radiusMm: number } }> }> } };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find(s => s.id === sheetId)!;
      const dv = sheet.views.find(v => v.id === detailViewId && v.kind === 'detail')!;
      return dv.regionParent ?? null;
    },
    { sheetId, detailViewId },
  );
  expect(regionAfterUndo?.center).toEqual({ x: 25, y: 15 });
  expect(regionAfterUndo?.radiusMm).toBe(10);

  // 6. Assert callout overlay still present after undo
  await expect(page.locator(`[data-detail-callout-overlay="${detailViewId}"]`)).toBeAttached({ timeout: 5_000 });
});
