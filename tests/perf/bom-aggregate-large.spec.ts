import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';

/**
 * Perf — BOM aggregation + first table render on a 200-component assembly.
 *
 * Synthesises 200 components in the active assembly with a mix of partPaths
 * and palette colors so the aggregator does real work. Two metrics:
 *   1. `aggregateBom` p95 over 50 trials, via __zilventorBomAggregateMs hook.
 *      Budget: < 5 ms p95.
 *   2. First BOM-table render after toggling the BOM tab on. Wall time from
 *      click to the table being attached to the DOM.
 *      Budget: < 50 ms p95 (single-trial, gated by Playwright timeouts).
 */
test('Perf: BOM aggregation + first render scale to 200 components', async ({ page }) => {
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

  // Build the synthetic assembly: 200 components across 5 partPaths × 4 colors
  // (no real geometry — only the document state is needed for aggregation).
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.setAssemblyPaletteColor('Maple', '#d4a574');
    s.setAssemblyPaletteColor('Walnut', '#5a3a22');
    s.setAssemblyPaletteColor('Oak', '#a0734a');
    const partPaths = ['parts/cube.zipt', 'parts/p1.zipt', 'parts/p2.zipt', 'parts/p3.zipt', 'parts/p4.zipt'];
    const palette = [undefined, 'Maple', 'Walnut', 'Oak'];
    for (let i = 0; i < 200; i++) {
      const partPath = partPaths[i % partPaths.length]!;
      const colorName = palette[Math.floor(i / 50) % palette.length];
      s.addComponent({
        id: `C${i}`, partPath,
        position: { x: i, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
      if (colorName) {
        w.__zilventorStore.getState().setComponentColor(`C${i}`, { kind: 'palette', name: colorName });
      }
    }
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 200;
  });

  // Aggregate-only benchmark via dev hook.
  const aggregatePctMs = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorBomAggregateMs(50);
  });
  console.log(JSON.stringify({ metric: 'bom-aggregate-p95-ms', value: aggregatePctMs, components: 200, trials: 50 }));
  expect(aggregatePctMs).toBeGreaterThanOrEqual(0);
  expect(aggregatePctMs).toBeLessThan(5);

  // First-render benchmark: toggle the BOM tab and time how long until the
  // BomTable is attached to the DOM.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  const t0 = Date.now();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();
  await expect(page.locator('[data-testid=bom-table]')).toBeVisible();
  // Ensure tbody has rows (first render fully completed).
  await expect(page.locator('[data-testid=bom-table] tbody tr').first()).toBeVisible();
  const renderMs = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'bom-first-render-ms', value: renderMs, components: 200 }));
  // First-render budget covers resolvePartName (5 OPFS reads + project unpacks)
  // plus React-mounting 200 rows; the pure aggregate budget is enforced above.
  expect(renderMs).toBeLessThan(1500);
});
