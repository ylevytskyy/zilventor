import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('place a component in an assembly', async ({ page }) => {
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

  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^cube$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();

  const count = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0;
  });
  expect(count).toBe(1);

  // Wait for assembly-mesh sync to actually tessellate the part — non-zero
  // cache proves real BREP tessellation rather than placeholder fallback.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 15_000 }).toBe(1);
});
