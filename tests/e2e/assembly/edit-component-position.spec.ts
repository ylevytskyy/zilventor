import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('edit a component position via dialog', async ({ page }) => {
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
  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // Wait for assembly-mesh sync to settle and produce a real geometry hash.
  let hashBefore = '0';
  await expect.poll(async () => {
    hashBefore = (await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash')) ?? '0';
    return hashBefore;
  }, { timeout: 10_000 }).not.toBe('0');

  // Double-click the component leaf in the BrowserPane to open the edit dialog.
  await page
    .locator('[data-testid=browser-pane]')
    .getByText(/cube/)
    .first()
    .dblclick();
  await expect(page.getByRole('dialog', { name: /edit component/i })).toBeVisible();

  // Change X to 50, click OK.
  const dialog = page.getByRole('dialog', { name: /edit component/i });
  await dialog.locator('input[aria-label="X"]').fill('50');
  await dialog.getByRole('button', { name: /^ok$/i }).click();
  await expect(page.getByRole('dialog', { name: /edit component/i })).toBeHidden();

  // The component's stored position.x must now be 50.
  const x = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components[0].position.x;
  });
  expect(x).toBe(50);

  // Geometry hash should change because the component transform changed.
  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 10_000 }).not.toBe(hashBefore);
});
