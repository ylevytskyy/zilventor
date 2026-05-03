import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T32 — broken material ref renders (missing material) + aria-invalid="true".
 *
 * Seeds a panel referencing 'm-birch', places it, then removes 'm-birch'
 * from the assembly's materials registry via the store's removeMaterial action.
 * Opens the Cut List tab and asserts:
 *   - The row carries aria-invalid="true".
 *   - The Material cell reads "(missing material)".
 */
test('T32 — cut-list row with broken material shows (missing material) and aria-invalid', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add 'm-birch' to the assembly registry.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addMaterial(m: unknown): void };
      };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed a panel part referencing 'm-birch'.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t32-panel.zipt',
    partName: 't32-panel',
    length: 600, width: 300, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Place 1 instance.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    w.__zilventorStore.getState().addComponent({
      id: 'C0', partPath: 'parts/t32-panel.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
    });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // 5. Populate the panel spec cache from OPFS.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Remove 'm-birch' from the assembly's materials registry to break the ref.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { removeMaterial(id: string): void };
      };
    };
    w.__zilventorStore.getState().removeMaterial('m-birch');
  });

  // 7. Open the Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 8. Assert the row carries aria-invalid="true".
  const row = page.locator('[data-cutlist-row]').first();
  await expect(row).toHaveAttribute('aria-invalid', 'true', { timeout: 10_000 });

  // 9. Assert the Material cell renders "(missing material)".
  await expect(row).toContainText('(missing material)');
});
