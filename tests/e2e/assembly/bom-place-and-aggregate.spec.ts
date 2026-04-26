import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T32 (sub-project 4c, Phase 12): place 3 cubes (same partPath, no color) and
 * verify the BOM tab aggregates them into a single row with QTY=3 and Item#=1.
 */
test('T32 — BOM aggregates same-part components into one row', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place 3 cubes via direct store mutation.
  await page.evaluate(() => {
    const w = window as any;
    const add = w.__zilventorStore.getState().addComponent;
    add({
      id: 'C0', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    add({
      id: 'C1', partPath: 'parts/cube.zipt',
      position: { x: 80, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    add({
      id: 'C2', partPath: 'parts/cube.zipt',
      position: { x: 160, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 3;
  });

  // Open BOM via the Assembly ribbon panel.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();

  const rows = bomTable.locator('tbody tr');
  await expect(rows).toHaveCount(1);

  const cells = rows.first().locator('td');
  // Item# (col 0)
  await expect(cells.nth(0)).toHaveText('1');
  // QTY (col 1)
  await expect(cells.nth(1)).toHaveText('3');
});
