import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedAssemblyCylinderPart } from '../helpers/seedAssemblyCylinderPart';

/**
 * T34 (sub-project 4c, Phase 12): inline-editing an Item# bumps a colliding
 * row to max+1, and clicking Renumber resequences 1..N by part name ASC.
 *
 * Note: until the autosave merge flushes, `activeAssembly.bomItemNumbers` is
 * empty — auto-assigned numbers only exist in the BOM table render. This
 * test reads numbers from the rendered DOM, not the store, until after the
 * inline-edit forces a store write.
 */
test('T34 — Item# inline-edit bumps colliding row; Renumber resequences', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);
  await seedAssemblyCylinderPart(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.addComponent({
      id: 'CUBE', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    s.addComponent({
      id: 'CYL', partPath: 'parts/cylinder.zipt',
      position: { x: 100, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();
  await expect(bomTable.locator('tbody tr')).toHaveCount(2);

  // Wait for the part-name cache to populate (BomTable initially renders
  // "(missing part)" until resolvePartName completes).
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-testid=bom-table] tbody tr td:nth-child(3)');
      return Array.from(cells).map((c) => (c.textContent ?? '').trim()).sort();
    });
  }, { timeout: 10_000 }).toEqual(['cube', 'cylinder']);

  // Click Renumber once to persist deterministic 1..N item numbers in the
  // store — the conflict-bump path needs both numbers in `bomItemNumbers`
  // because it only bumps existing entries.
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^renumber$/i }).click();

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return Object.values(w.__zilventorStore.getState().activeAssembly.bomItemNumbers).map((v) => v as number).sort((a, b) => a - b);
    });
  }, { timeout: 5_000 }).toEqual([1, 2]);

  // Inline-edit the cube row's Item# to 2 — collides with the cylinder row,
  // which should bump to max+1 = 3.
  const cubeRowLocator = bomTable.locator('tbody tr').filter({ hasText: 'parts/cube.zipt' }).first();
  await cubeRowLocator.locator('td').nth(0).locator('span').click();

  const editInput = bomTable.locator('input[aria-label^="item-number-"]');
  await expect(editInput).toBeVisible();
  await editInput.fill('2');
  await editInput.blur();

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return Object.values(w.__zilventorStore.getState().activeAssembly.bomItemNumbers).map((v) => v as number).sort((a, b) => a - b);
    });
  }, { timeout: 5_000 }).toEqual([2, 3]);

  // Click Renumber. Both rows resequence to 1..2 by part name (cube < cylinder).
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^renumber$/i }).click();

  const finalMap = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.bomItemNumbers as Record<string, number>;
  });
  const cubeKey = Object.keys(finalMap).find((k) => k.startsWith('parts/cube.zipt'))!;
  const cylKey = Object.keys(finalMap).find((k) => k.startsWith('parts/cylinder.zipt'))!;
  expect(finalMap[cubeKey]).toBe(1);
  expect(finalMap[cylKey]).toBe(2);
});
