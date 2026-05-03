import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T29 — cut-list row click multi-selects all matching component instances
 *        and applies the orange outline overlay via the viewport SceneManager.
 *
 * Seeds 1 panel part, places 2 instances (C0, C1). Clicks the single cut-list
 * row — both components should be selected and have overlays.
 */
test('T29 — cut-list row click multi-selects matching components', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add material to assembly registry.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed a single panel part.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t29-panel.zipt',
    partName: 't29-panel',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Place 2 instances of the same panel part.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t29-panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t29-panel.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 5. Wait for the assembly-mesh-sync effect to mount the meshes (geometry hash changes).
  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 15_000 }).not.toBe('0');

  // 6. Load panel specs and open Cut List tab.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 7. Assert exactly 1 row (both C0 and C1 share the same panel spec → QTY=2).
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(1, { timeout: 10_000 });
  await expect(rows.first().locator('td').nth(1)).toHaveText('2');

  // 8. Click the row — should select both C0 and C1.
  // The ItemNumberCell stops propagation on click, so click on QTY cell (td[1]).
  await rows.first().locator('td').nth(1).click();

  // 9. Assert both components are selected via the store.
  const selectedPaths = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { selectedComponentPaths: string[][] } };
    };
    return w.__zilventorStore.getState().selectedComponentPaths;
  });
  expect(new Set(selectedPaths.map((p) => p[0]))).toEqual(new Set(['C0', 'C1']));

  // 10. Assert orange outline overlays exist for both components via the viewport hook.
  const overlays = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorComponentSelectedOverlay: (id: string) => boolean;
    };
    return {
      c0: w.__zilventorComponentSelectedOverlay('C0'),
      c1: w.__zilventorComponentSelectedOverlay('C1'),
    };
  });
  expect(overlays.c0).toBe(true);
  expect(overlays.c1).toBe(true);
});
