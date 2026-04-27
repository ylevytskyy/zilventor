import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T38 (sub-project 4c, Phase 12): when a palette entry is removed while
 * components still reference its name, the BOM aggregator treats those
 * components as having no color (display only). The component data is left
 * intact so re-adding the palette name restores the link.
 */
test('T38 — orphan palette refs aggregate as no-color and viewport falls back to grey', async ({ page }) => {
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
    s.setAssemblyPaletteColor('Maple', '#d4a574');
    s.addComponent({
      id: 'C0', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    w.__zilventorStore.getState().setComponentColor('C0', { kind: 'palette', name: 'Maple' });
    w.__zilventorStore.getState().setShowComponentColors(true);
  });

  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 10_000 }).not.toBe('0');

  // Initially: BOM row shows "Maple"; mesh material renders the palette hex.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();
  await expect(bomTable.locator('tbody tr td').nth(3)).toHaveText('Maple');

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      const v = w.__zilventorComponentMaterialHex('C0');
      return v ? v.toLowerCase() : null;
    });
  }, { timeout: 5_000 }).toBe('#d4a574');

  // Remove the palette entry. Component still references "Maple" by name —
  // aggregator should treat that as no-color, and the viewport should revert
  // to the shared grey.
  await page.evaluate(() => {
    const w = window as any;
    w.__zilventorStore.getState().removeAssemblyPaletteColor('Maple');
  });

  await expect(bomTable.locator('tbody tr td').nth(3)).toHaveText('—');

  const greyHex = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorComponentMaterialHex('C0');
  });
  expect(greyHex).not.toBeNull();
  expect(greyHex!.toLowerCase()).not.toBe('#d4a574');
});
