import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T26 — edge-band totals.
 *
 * Seeds a 600×400 panel with PVC 1mm white bands on Front and Back edges.
 * Places 3 instances. Asserts the Edge Band Totals section shows:
 *   - Material: "PVC 1mm white"
 *   - Total (mm): 3600 mm  (front=600 + back=600 per panel × 3 panels)
 *   - Total (m): 3.600
 *
 * The aggregator uses length (not width) for front/back edges.
 * Per instance: 600 (front) + 600 (back) = 1200 mm.
 * For qty=3: 1200 × 3 = 3600 mm = 3.600 m.
 */
test('T26 — 600x400 panel PVC front+back × 3 → 3600 mm edge-band total', async ({ page }) => {
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

  // 2. Add both materials to the assembly registry.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addMaterial(m: unknown): void };
      };
    };
    const add = w.__zilventorStore.getState().addMaterial;
    add({ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    add({ id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' });
  });

  // 3. Seed the panel part with PVC bands on front and back.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t26-banded.zipt',
    partName: 't26-banded',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    edgeBands: {
      front: { materialId: 'm-pvc' },
      back: { materialId: 'm-pvc' },
    },
    materials: [
      { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
      { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
    ],
  });

  // 4. Place 3 instances.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addComponent(c: unknown): void };
      };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t26-banded.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t26-banded.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C2', partPath: 'parts/t26-banded.zipt', position: { x: 1400, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 3;
  });

  // 5. Populate the panel spec cache from OPFS.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Open the Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 7. Assert Edge Band Totals section is present.
  await expect(page.getByText('Edge Band Totals')).toBeVisible({ timeout: 10_000 });

  // 8. Assert PVC material name appears at least once (present in front/back edge
  //    band columns on the panel row and in the Edge Band Totals section).
  await expect(page.getByText('PVC 1mm white').first()).toBeVisible();

  // 9. Assert total in mm: 3600 mm.
  await expect(page.getByText('3600 mm')).toBeVisible();

  // 10. Assert total in m: 3.600.
  await expect(page.getByText('3.600')).toBeVisible();
});
