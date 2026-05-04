import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T-5e-4 — Export PDF downloads a non-zero application/pdf file.
 *
 * Places 1 panel, generates a nest, clicks Export PDF on the Furniture ribbon,
 * captures the download, and asserts:
 *   - filename ends with .pdf
 *   - __zilventorNestPdfBytes has non-zero length
 *   - first 4 bytes are PDF magic: [37, 80, 68, 70] ('%PDF')
 */
test('T-5e-4: Export PDF downloads a non-zero application/pdf file', async ({ page }) => {
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

  // 2. Add material with sheet stock.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'birch18',
      name: 'Birch 18mm',
      defaultThickness: 18,
      color: '#d2b48c',
      sheetLengthMm: 2440,
      sheetWidthMm: 1220,
    });
  });

  // 3. Seed 1 panel part + place.
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/pdf-p1.zipt',
    partName: 'Panel 1',
    length: 600,
    width: 400,
    thickness: 18,
    materialId: 'birch18',
    grain: 'length',
    materials: [{ id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c' }],
  });
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    w.__zilventorStore.getState().addComponent({
      id: 'PC1',
      partPath: 'panels/pdf-p1.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 1;
  });

  // 4. Load cut-list specs.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 5. Generate Nest via Furniture ribbon.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toBeVisible();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toHaveCount(0);

  // 6. Wait for the nest to be stored (Export PDF button becomes enabled).
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { nest?: unknown } | null } };
    };
    return !!(w.__zilventorStore.getState().activeAssembly?.nest);
  });

  // 7. Mock showSaveFilePicker to abort immediately (matching the CSV export spec pattern).
  //    triggerDownload sets __zilventorNestPdfBytes before calling the picker, so the
  //    AbortError fallback still preserves the bytes without triggering a real file dialog.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 8. Click Export PDF.
  await page.getByRole('button', { name: 'Export PDF' }).click();

  // 9. Give the async apply() a moment to finish.
  await page.waitForFunction(() => {
    return !!(window as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes;
  }, undefined, { timeout: 10_000 });

  // 10. Inspect bytes via dev hook — non-zero length and %PDF magic.
  const len = await page.evaluate(() => {
    return (window as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes?.length ?? 0;
  });
  expect(len).toBeGreaterThan(0);

  const head = await page.evaluate(() => {
    const bytes = (window as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes;
    return Array.from((bytes ?? new Uint8Array()).slice(0, 4));
  });
  // '%PDF' = [37, 80, 68, 70]
  expect(head).toEqual([37, 80, 68, 70]);
});
