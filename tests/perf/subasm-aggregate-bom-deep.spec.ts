import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../e2e/helpers/seedSubAssembly';

/**
 * T43 (4d Phase 12): Perf — `aggregateBomRecursive` p95 < 5 ms across a
 * 3-level / 200-leaf sub-assembly tree.
 *
 * Tree:
 *   parts/cube.zipt (panel)
 *     ↑ × 5
 *   drawer.ziasm (5 panels)
 *     ↑ × 4
 *   cabinet.ziasm (4 drawers = 20 panels)
 *     ↑ × 10 (top assembly)
 *
 * Total panel leaves = 10 × 4 × 5 = 200.
 *
 * Measured via the `__zilventorBomAggregateRecursiveMs` dev hook over 50
 * trials.
 */
test('Perf: aggregateBomRecursive p95 < 5ms across 3-level 200-leaf tree', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // drawer.ziasm: 5 panels.
  const drawer = makeSubAsmDoc('drawer', Array.from({ length: 5 }, (_, i) => ({
    id: `pa${i}`,
    partPath: 'parts/cube.zipt',
    position: { x: i * 60, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  })));
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);

  // cabinet.ziasm: 4 drawers.
  const cabinet = makeSubAsmDoc('cabinet', Array.from({ length: 4 }, (_, i) => ({
    id: `da${i}`,
    partPath: 'drawer.ziasm',
    position: { x: 0, y: i * 200, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  })));
  await seedSubAssemblyZiasm(page, 'cabinet.ziasm', cabinet);

  // Top assembly: 10 cabinets, programmatically (no dialog).
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    for (let i = 0; i < 10; i++) {
      s.addComponent({
        id: `cab${i}`,
        partPath: 'cabinet.ziasm',
        position: { x: i * 1000, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 10;
  });

  // Hydrate the recursive sub-asm cache.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // Sanity: 10 × 4 × 5 = 200 leaves.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 10_000 }).toBe(200);

  // Aggregate-only benchmark via dev hook.
  const aggregateP95Ms = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorBomAggregateRecursiveMs(50);
  });
  console.log(JSON.stringify({
    metric: 'subasm-aggregate-bom-recursive-p95-ms',
    value: aggregateP95Ms,
    leaves: 200,
    trials: 50,
  }));
  expect(aggregateP95Ms).toBeGreaterThanOrEqual(0);
  expect(aggregateP95Ms).toBeLessThan(5);
});
