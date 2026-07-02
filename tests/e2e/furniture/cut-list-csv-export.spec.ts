import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T30 — cut-list CSV export produces a 3-section CSV.
 *
 * Seeds a banded panel part (PVC front+back), places 2 instances, opens
 * the Cut List tab, clicks Export CSV (with showSaveFilePicker mocked to
 * abort), then reads __zilventorCutListCsvBytes and asserts:
 *   - Section 1 header: Item#,QTY,Material,...
 *   - Section 2 header: Edge Band Material,...
 *   - Section 3 footer: Excluded from cut list,...
 */
test('T30 — cut-list CSV export captures 3-section content', async ({ page }) => {
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

  // 2. Add materials to the assembly registry.
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

  // 3. Seed a banded panel part to OPFS.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t30-panel.zipt',
    partName: 't30-panel',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    edgeBands: {
      front: { materialId: 'm-pvc', thickness: 1 },
      back: { materialId: 'm-pvc', thickness: 1 },
    },
    materials: [
      { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
      { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
    ],
  });

  // 4. Place 2 instances.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t30-panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t30-panel.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 5. Populate the panel spec cache from OPFS.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Open Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 7. Wait for rows to appear.
  await expect(page.locator('[data-cutlist-row]').first()).toBeVisible({ timeout: 10_000 });

  // 8. Mock showSaveFilePicker to cancel immediately (so apply() still sets the bytes).
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 9. Click Export CSV.
  await page.getByRole('button', { name: 'Export CSV' }).click();

  // 10. Read the captured bytes and decode to CSV.
  const csv = await page.evaluate(() => {
    const w = window as unknown as { __zilventorCutListCsvBytes?: Uint8Array };
    if (!w.__zilventorCutListCsvBytes) return null;
    return new TextDecoder().decode(w.__zilventorCutListCsvBytes);
  });

  expect(csv).not.toBeNull();
  // Section 1: panel rows header.
  expect(csv).toContain('Item#,QTY,Material,L (mm),W (mm),Gross L (mm),Gross W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  // Birch 18mm panel row with QTY 2.
  expect(csv).toMatch(/\d+,2,Birch 18mm,600,400,600,402,18,length/);
  // Section 2: edge-band totals header.
  expect(csv).toContain('Edge Band Material,Total Length (mm),Total Length (m)');
  // PVC band row: front+back × 600 × 2 instances = 2400 mm.
  expect(csv).toContain('PVC 1mm white,2400,2.400');
  // Section 3: exclusion footer.
  expect(csv).toContain('Excluded from cut list,0 components,0 distinct parts');
});
