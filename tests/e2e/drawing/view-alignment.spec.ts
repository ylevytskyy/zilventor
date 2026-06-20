// tests/e2e/drawing/view-alignment.spec.ts
// M3.4 §6 e2e — Enforced projected-view alignment: dragging a base view in the
// drawing canvas moves the base AND its projected view together by the same delta.
//
// Pattern mirrors auto-regen.spec.ts: build a real box part, create a drawing, place a
// base view (real projection) + a projected view, switch to the Drawing tab, then perform
// a REAL mouse drag over the base view's <g data-view-id> element and assert via the store
// probe that both views shifted by the identical delta (MoveViewCommand cascade).

import { test, expect } from '@playwright/test';
import { waitForKernelReady, buildBox } from '../helpers/buildBox';

test('view-alignment: dragging a base view moves its projected view by the same delta', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Real box part + warm kernel so projection works.
  await buildBox(page, { width: 60, height: 40, depth: 30 });

  // 2. Create a drawing, place a base view + a downward projected view.
  const { baseViewId, projViewId, baseStart, projStart } = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { id: string } | null; kernel: { execute(id: string): Promise<unknown> } | null };
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || !s.kernel) throw new Error('view-alignment: kernel or activePart not ready');
    await s.kernel.execute(s.activePart.id);

    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath: `${s.activePart.id}.zipt`, sourceKind: 'part' }).apply();

    const store = window as unknown as {
      __zilventorStore: { getState(): { activeDocument: { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; baseViewId?: string; positionMm: { x: number; y: number } }> }> } } } };
    };
    const sheetId = store.__zilventorStore.getState().activeDocument.document.sheets[0]!.id;

    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId, positionMm: { x: 120, y: 90 }, orientation: 'front', scale: { numerator: 1, denominator: 1 },
    }).apply();

    const baseView = store.__zilventorStore.getState().activeDocument.document.sheets
      .find((sh) => sh.id === sheetId)!.views.find((v) => v.kind === 'base')!;

    const { AddProjectedViewCommand } = await import('/src/commands/AddProjectedViewCommand.ts');
    await new AddProjectedViewCommand({
      sheetId, baseViewId: baseView.id, direction: 'bottom', positionMm: { x: 120, y: 200 },
    }).apply();

    const sheet = store.__zilventorStore.getState().activeDocument.document.sheets.find((sh) => sh.id === sheetId)!;
    const proj = sheet.views.find((v) => v.kind === 'projected')!;
    return {
      baseViewId: baseView.id,
      projViewId: proj.id,
      baseStart: baseView.positionMm,
      projStart: proj.positionMm,
    };
  });

  // 3. Switch to the Drawing tab and confirm both views render.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`g[data-view-id="${projViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 4. Perform a real mouse drag, grabbing the base view by its top edge stroke
  //    (the empty interior carries no element to hit-test against).
  const box = await page.locator(`g[data-view-id="${baseViewId}"]`).boundingBox();
  if (!box) throw new Error('view-alignment: base view has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + 1; // on the top outline stroke
  const DX = 60;
  const DY = 40;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + DX, startY + DY, { steps: 5 });
  await page.mouse.up();

  // 5. Assert both views moved by the SAME (non-zero) delta — enforced alignment.
  const result = await page.evaluate(({ baseViewId, projViewId }) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDrawing: { sheets: Array<{ views: Array<{ id: string; positionMm: { x: number; y: number } }> }> } | null } };
    };
    const views = w.__zilventorStore.getState().activeDrawing!.sheets[0]!.views;
    const base = views.find((v) => v.id === baseViewId)!.positionMm;
    const proj = views.find((v) => v.id === projViewId)!.positionMm;
    return { base, proj };
  }, { baseViewId, projViewId });

  const baseDx = result.base.x - baseStart.x;
  const baseDy = result.base.y - baseStart.y;
  const projDx = result.proj.x - projStart.x;
  const projDy = result.proj.y - projStart.y;

  // Base actually moved...
  expect(Math.abs(baseDx) + Math.abs(baseDy)).toBeGreaterThan(0.5);
  // ...and the projected view followed by the IDENTICAL delta.
  expect(projDx).toBeCloseTo(baseDx, 3);
  expect(projDy).toBeCloseTo(baseDy, 3);
});
