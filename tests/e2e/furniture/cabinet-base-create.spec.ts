import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5b-1 — create a base cabinet from Furniture → Cabinets → Base Cabinet', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Base Cabinet' }).click();

  await expect(page.getByRole('dialog', { name: 'Cabinet' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Cabinet' })).toHaveCount(0);

  // Wait for the async CreateCabinetCommand to finish placing the component.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  const counts = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    const componentCount = w.__zilventorStore.getState().activeAssembly.components.length;
    const root = await navigator.storage.getDirectory();
    let fileCount = 0;
    // @ts-expect-error iterator typing
    for await (const [name] of root.entries()) {
      if (name.startsWith('Base Cabinet 1')) fileCount++;
    }
    return { componentCount, fileCount };
  });
  expect(counts.componentCount).toBe(1);
  expect(counts.fileCount).toBe(8);
});
