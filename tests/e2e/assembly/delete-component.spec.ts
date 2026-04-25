import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('delete a component via the Assembly ribbon', async ({ page }) => {
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

  // Place a single component.
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
  await page.getByText(/^cube$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Programmatically select the placed component (the viewport raycaster
  // is exercised by other tests; this one focuses on the Delete path).
  await page.evaluate(() => {
    const w = window as any;
    const id = w.__zilventorStore.getState().activeAssembly.components[0].id;
    w.__zilventorStore.getState().selectComponent(id);
  });

  // Switch to the Assembly ribbon tab to access Place/Edit/Delete buttons.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: /^delete$/i }).click();

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? -1) === 0;
  });

  const count = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? -1;
  });
  expect(count).toBe(0);
});
