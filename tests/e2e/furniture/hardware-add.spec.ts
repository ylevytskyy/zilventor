import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5c-1 — Add Hardware: place 35mm cup hinge, verify OPFS file + cut list row', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Open Furniture → Hardware → Add Hardware.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();

  // 3. Dialog opens; default is Hinges, first SKU selected.
  await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();
  const radioFull = page.getByRole('radio', { name: /35mm Cup Hinge.*Full Overlay/i });
  await expect(radioFull).toBeChecked();

  // 4. Click OK.
  await page.getByRole('button', { name: /^ok$/i }).click();
  await expect(page.getByRole('dialog', { name: /hardware/i })).toHaveCount(0);

  // 5. Wait for component to appear.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // 6. Assert OPFS file exists.
  const fileExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      // @ts-expect-error iterator typing
      for await (const [name] of root.entries()) {
        if (name === 'hardware') return true;
      }
    } catch { /* */ }
    return false;
  });
  expect(fileExists).toBe(true);

  // 7. Open Cut List tab and verify Hardware section shows 1 row.
  await page.getByRole('button', { name: /cut list/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { cutListTabActive: boolean } } };
    return w.__zilventorStore.getState().cutListTabActive;
  });
  await expect(page.getByText('35mm Cup Hinge — Full Overlay')).toBeVisible();
  await expect(page.getByText('1')).toBeVisible();
});
