import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';
import { seedAssemblyCubePart } from '../e2e/helpers/seedAssemblyPart';

/**
 * Perf — assembly autosave debounce coalesces rapid component placements.
 *
 * App.tsx's autosave watches activeDocument and writes
 * `${doc.name}.zipt`/`.ziasm` to OPFS 500 ms after the last mutation.
 * 20 rapid addComponent calls within ~50 ms should produce a single
 * trailing autosave write — not 20.
 *
 * Assertions:
 *   - writeCount >= 1   (at least one autosave fired)
 *   - writeCount <= 3   (debounce coalesced the burst; expected 1)
 *   - wall time <= 3000 ms
 */
test('Perf: 500ms autosave debounce coalesces rapid component placements', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Create a fresh assembly via UI so it has a name.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Wait for the initial autosave (the empty-assembly write) to clear, then
  // zero the writeCount so the burst measurement below is isolated.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = window as any;
    const stats = w.__zilventorAutosaveStats?.();
    if (stats) stats.writeCount = 0;
  });

  // Rapid-fire 20 addComponent calls with no delay between them.
  const startMs = Date.now();
  await page.evaluate(() => {
    const w = window as any;
    for (let i = 0; i < 20; i++) {
      w.__zilventorStore.getState().addComponent({
        id: `C${i}`, partPath: 'parts/cube.zipt',
        position: { x: i * 10, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  // Wait for the trailing debounce to fire (500 ms) plus a settle margin.
  await page.waitForTimeout(1000);
  const endMs = Date.now();

  const writeCount = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorAutosaveStats?.()?.writeCount ?? -1;
  });
  const totalMs = endMs - startMs;
  console.log(JSON.stringify({ metric: 'assembly-place-debounce', writeCount, totalMs }));

  expect(writeCount).toBeGreaterThanOrEqual(1);
  expect(writeCount).toBeLessThanOrEqual(3);
  expect(totalMs).toBeLessThanOrEqual(3000);
});
