import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('placing the same part 3 times shares geometry', async ({ page }) => {
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

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cube$/).click();
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

  const count = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0;
  });
  expect(count).toBe(3);

  // Wait for the assembly-mesh sync effect to finish tessellating — observable
  // via a non-zero data-geometry-hash. Once the hash settles, the cache is
  // populated.
  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 15_000 }).not.toBe('0');

  // Geometry cache should hold a single BufferGeometry — the cube — even
  // though three components reference it.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 15_000 }).toBe(1);
});
