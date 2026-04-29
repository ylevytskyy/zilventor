import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T39 (4d Phase 11b): when a placed sub.ziasm goes missing in OPFS,
 * `__zilventorSubAsmInvalidate` drops it from the store mirror and the
 * recursive walkers degrade gracefully:
 *
 *  - `__zilventorSubAsmCacheGet('sub.ziasm')` returns undefined
 *  - visibleLeaves emits a single placeholder for the broken placement →
 *    `__zilventorComponentPathToLeafCount([])` stays at 1
 *  - aggregateBomRecursive skips the missing sub-asm entirely → BOM is
 *    empty (no rows from the no-longer-loadable interior).
 */
test('T39 — broken sub-asm ref renders placeholder + empty BOM', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Sub-asm with two cube leaves so its interior would otherwise contribute
  // 2 BOM entries (qty=2 on `parts/cube.zipt`).
  const sub = makeSubAsmDoc('sub', [
    { id: 'pa', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'parts/cube.zipt',
      position: { x: 80, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);

  // Open a fresh top assembly and place sub.ziasm.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^sub$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Hydrate the cache so the recursive walker initially expands the sub-asm.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // Sanity-check: with the sub-asm loaded we see 2 leaves.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 5_000 }).toBe(2);

  // Now remove the file from OPFS (simulates user-renaming sub.ziasm),
  // then invalidate the cache for that path. The hook re-reads from OPFS
  // and drops the entry when the file no longer exists.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('sub.ziasm');
    const w = window as any;
    await w.__zilventorSubAsmInvalidate('sub.ziasm');
  });

  // Cache no longer has the entry — diagnostic via undefined return.
  const cacheEntry = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorSubAsmCacheGet?.('sub.ziasm');
  });
  expect(cacheEntry).toBeUndefined();

  // visibleLeaves emits a single placeholder for the broken placement.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 5_000 }).toBe(1);

  // BOM aggregator skips the missing sub-asm — no rows.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();
  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();
  await expect(bomTable.locator('tbody tr')).toHaveCount(0);
});
