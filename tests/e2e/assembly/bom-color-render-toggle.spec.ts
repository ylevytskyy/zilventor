import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T37 (sub-project 4c, Phase 12): toggling the View tab "Show component
 * colors" button flips a component mesh's material to the assigned hex when
 * on, and back to the shared grey when off.
 */
test('T37 — Show component colors toggle swaps the mesh material', async ({ page }) => {
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

  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    s.addComponent({
      id: 'C0', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    w.__zilventorStore.getState().setComponentColor('C0', { kind: 'hex', hex: '#cc8866' });
  });

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentMaterialHex('C0');
    });
  }, { timeout: 10_000 }).not.toBeNull();

  // Sample the off-state material hex (shared grey).
  const greyHex = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorComponentMaterialHex('C0');
  });
  expect(greyHex).not.toBeNull();
  expect(greyHex!.toLowerCase()).not.toBe('#cc8866');

  // Toggle on.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: /show component colors/i }).click();

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      const v = w.__zilventorComponentMaterialHex('C0');
      return v ? v.toLowerCase() : null;
    });
  }, { timeout: 5_000 }).toBe('#cc8866');

  // Toggle off — reverts to the shared grey hex.
  await page.getByRole('button', { name: /show component colors/i }).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      const v = w.__zilventorComponentMaterialHex('C0');
      return v ? v.toLowerCase() : null;
    });
  }, { timeout: 5_000 }).toBe(greyHex!.toLowerCase());
});
