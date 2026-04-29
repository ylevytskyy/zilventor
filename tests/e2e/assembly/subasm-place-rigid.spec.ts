import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T35 (4d Phase 11): place a rigid sub-assembly twice in a fresh top
 * assembly. Verify the recursive walker renders 6 leaves (3 panels × 2
 * drawers) and the BOM aggregates them into a single row with QTY=6.
 */
test('T35 — place a rigid sub-asm twice; render + BOM aggregate', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  // Seed a cube part — the drawer.ziasm will reference it three times.
  await seedAssemblyCubePart(page);

  const drawer = makeSubAsmDoc('drawer', [
    { id: 'pa', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'parts/cube.zipt',
      position: { x: 80, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pc', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 80, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);

  // Open a fresh top assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place drawer.ziasm twice via the Place dialog.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^drawer$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
    await page.waitForFunction(
      (expected) => {
        const w = window as any;
        return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === expected;
      },
      i + 1,
    );
  }

  // The sub-asm cache is populated lazily via the dev hook; here we call it
  // explicitly so visibleLeaves + BOM aggregation can expand drawer.ziasm.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // The recursive sub-asm walker should expand each drawer into 3 leaves
  // → 6 visible leaves total. __zilventorComponentPathToLeafCount([]) is
  // total leaf count (T33 dev hook).
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 10_000 }).toBe(6);

  // Open BOM via the Assembly ribbon panel.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();

  const rows = bomTable.locator('tbody tr');
  await expect(rows).toHaveCount(1);

  // QTY (col 1) — 3 panels × 2 drawers = 6.
  await expect(rows.first().locator('td').nth(1)).toHaveText('6');
});
