// tests/e2e/drawing/T-6-14-edit-detail-region.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-14 — Edit Detail Region (F2.4):
 * Inject a base view + detail view, enter editDetailRegion mode via store,
 * simulate a center drag via store action (updateDetailRegionLive), assert
 * regionParent.center changed, assert projection edge fingerprint changed,
 * simulate a radius drag, assert radiusMm changed, then dispatch a real
 * EditDetailRegionCommand through the command bus and undo via bus.undo(),
 * asserting the region (center/radius) AND projection are restored.
 *
 * Undo pattern mirrors T-6-13 Case 1 (stepped section):
 *   bus.execute(cmd)  — dispatched via w.__zilventorStore.getState().bus.execute(cmd)
 *   bus.undo()        — via w.__zilventorStore.getState().bus.undo()
 * Commands are imported inside page.evaluate with: await import('/src/commands/EditDetailRegionCommand.ts')
 *
 * Uses store injection to avoid OPFS dependency (mirrors T-6-8 pattern).
 * The rendering pipeline (DetailRegionEditHandles) is verified in Task 3.5 (Playwright mid-flight).
 */
test('T-6-14: Edit Detail Region — center drag + radius drag + real command-bus undo restores region', async ({ page }) => {
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

  // 5. Reset the detail view state to its original injected state before testing
  //    the real command bus — updateDetailRegionLive is a transient store write that
  //    bypasses the bus; we restore it so the command bus undo test has a clean baseline.
  await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { updateDetailRegionLive?: (s: string, d: string, r: unknown) => void } };
      };
      w.__zilventorStore.getState().updateDetailRegionLive?.(
        sheetId, detailViewId,
        { center: { x: 25, y: 15 }, radiusMm: 10 },
      );
    },
    { sheetId, detailViewId },
  );

  // 6. Capture the original projection fingerprint before the real command dispatch.
  const origFingerprint = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; inputFingerprint?: string; regionParent?: { center: { x: number; y: number }; radiusMm: number } }> }> } };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find(s => s.id === sheetId)!;
      const dv = sheet.views.find(v => v.id === detailViewId && v.kind === 'detail')!;
      return dv.inputFingerprint ?? null;
    },
    { sheetId, detailViewId },
  );

  // 7. Dispatch real EditDetailRegionCommand through the command bus.
  //    prevRegion = original injected region; newRegion = new position + larger radius.
  //    This exercises the full apply() path: reprojectDetailRegion → store update.
  const dispatchResult = await page.evaluate(
    async ({
      sheetId, detailViewId,
    }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; regionParent?: { center: { x: number; y: number }; radiusMm: number }; inputFingerprint?: string }> }> } } | null;
            bus: { execute(cmd: { apply(): Promise<void>; revert(): Promise<void> }): Promise<void> };
          };
        };
      };

      const { EditDetailRegionCommand } = await import('/src/commands/EditDetailRegionCommand.ts');

      const cmd = new EditDetailRegionCommand({
        sheetId,
        detailViewId,
        prevRegion: { center: { x: 25, y: 15 }, radiusMm: 10 },
        newRegion:  { center: { x: 60, y: 25 }, radiusMm: 15 },
      });

      try {
        await w.__zilventorStore.getState().bus.execute(cmd);
      } catch (e) {
        return { ok: false, error: String(e), region: null, fingerprint: null };
      }

      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find(sh => sh.id === sheetId);
      const dv = sheet?.views.find(v => v.id === detailViewId && v.kind === 'detail');
      return {
        ok: true,
        error: null,
        region: dv?.regionParent ?? null,
        fingerprint: dv?.inputFingerprint ?? null,
      };
    },
    { sheetId, detailViewId },
  );

  // Command must succeed.
  if (!dispatchResult.ok) {
    throw new Error(`EditDetailRegionCommand dispatch failed: ${dispatchResult.error}`);
  }

  // Region must reflect newRegion.
  expect(dispatchResult.region?.center).toEqual({ x: 60, y: 25 });
  expect(dispatchResult.region?.radiusMm).toBe(15);

  // Projection fingerprint must have changed (reprojectDetailRegion ran).
  expect(dispatchResult.fingerprint).not.toBeNull();
  expect(dispatchResult.fingerprint).not.toBe(origFingerprint);

  // 8. Undo via the real command bus — exercises EditDetailRegionCommand.revert().
  const undoOk = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
    };
    return w.__zilventorStore.getState().bus.undo();
  });
  expect(undoOk).toBe(true);

  // 9. Assert region AND projection are restored to the original injected values.
  const regionAfterUndo = await page.evaluate(
    ({ sheetId, detailViewId }: { sheetId: string; detailViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; regionParent?: { center: { x: number; y: number }; radiusMm: number }; inputFingerprint?: string }> }> } };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find(s => s.id === sheetId)!;
      const dv = sheet.views.find(v => v.id === detailViewId && v.kind === 'detail')!;
      return { region: dv.regionParent ?? null, fingerprint: dv.inputFingerprint ?? null };
    },
    { sheetId, detailViewId },
  );

  // region restored to prevRegion
  expect(regionAfterUndo?.region?.center).toEqual({ x: 25, y: 15 });
  expect(regionAfterUndo?.region?.radiusMm).toBe(10);

  // projection fingerprint restored to the original (undo re-ran reprojectDetailRegion
  // with prevRegion, which produces the same fingerprint as the original injection used).
  expect(regionAfterUndo?.fingerprint).toBe(origFingerprint);

  // 10. Assert callout overlay still present after undo
  await expect(page.locator(`[data-detail-callout-overlay="${detailViewId}"]`)).toBeAttached({ timeout: 5_000 });
});
