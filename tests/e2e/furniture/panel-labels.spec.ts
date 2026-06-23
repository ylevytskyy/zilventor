import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T-5e-5 — Export Labels (PDF) produces a non-zero PDF file.
 *
 * Places 1 panel, generates a nest, clicks "Export Labels (PDF)" on the Furniture ribbon,
 * and asserts:
 *   - __zilventorPanelLabelsBytes has non-zero length
 *   - first 4 bytes are PDF magic: '%PDF'
 *   - 0 console errors and 0 page errors during the flow
 */
test('T-5e-5: Export Labels (PDF) produces a non-zero PDF file', async ({ page }) => {
  test.setTimeout(300_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
  });

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
    partPath: 'panels/labels-p1.zipt',
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
      id: 'LC1',
      partPath: 'panels/labels-p1.zipt',
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

  // 6. Wait for the nest to be stored (Export Labels button becomes enabled).
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { nest?: unknown } | null } };
    };
    return !!(w.__zilventorStore.getState().activeAssembly?.nest);
  });

  // 7. Stub showSaveFilePicker to abort immediately — forces the <a download> fallback.
  //    ExportPanelLabelsCommand sets __zilventorPanelLabelsBytes before calling the picker,
  //    so the AbortError fallback still preserves the bytes without a real file dialog.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 8. Click Export Labels (PDF).
  await page.getByRole('button', { name: 'Export Labels (PDF)' }).click();

  // 9. Wait for the bytes hook to be populated.
  await page.waitForFunction(() => {
    return !!(window as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes;
  }, undefined, { timeout: 10_000 });

  // 10. Assert PDF magic and non-zero length.
  const header = await page.evaluate(() => {
    const b = (globalThis as { __zilventorPanelLabelsBytes?: Uint8Array }).__zilventorPanelLabelsBytes;
    if (!b) return null;
    return { len: b.length, magic: String.fromCharCode(b[0], b[1], b[2], b[3]) };
  });
  expect(header).not.toBeNull();
  expect(header!.magic).toBe('%PDF');
  expect(header!.len).toBeGreaterThan(0);

  // 11. Assert 0 console errors and 0 page errors.
  const unexpectedConsole = consoleErrors.filter((e) => !/ResizeObserver/.test(e));
  expect(unexpectedConsole, `unexpected console errors:\n${unexpectedConsole.join('\n')}`).toEqual([]);
  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
