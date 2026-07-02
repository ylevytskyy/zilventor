import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * P8 — Production tab manual code entry marks a physical panel copy produced,
 * and the packing-slip export produces a non-zero PDF file.
 *
 * Places 1 panel (no nest needed — Production only needs the cut list),
 * opens the Production tab from the Furniture ribbon, types the panel's
 * exact QR payload (built the same way buildPanelLabels does:
 * `Z|{itemNumber}|{copyIndex}/{copyCount}|{length}x{width}x{thickness}|{materialName}`),
 * submits it, and asserts the row's status flips to "Produced". Also exercises
 * the packing-slip PDF export.
 */
test('P8: Production tab manual code entry marks a panel produced', async ({ page }) => {
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

  // 2. Add material.
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
    partPath: 'panels/production-p1.zipt',
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
      partPath: 'panels/production-p1.zipt',
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

  // 5. Open Production tab via the Furniture ribbon.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Open Production' }).click();

  // 6. Wait for the seeded panel's row to render.
  const rowKey = '1:1'; // itemNumber 1 (first/only row), copy 1 (qty 1)
  await expect(page.getByTestId(`production-status-${rowKey}`)).toBeVisible();
  await expect(page.getByTestId(`production-status-${rowKey}`)).toHaveText('Not produced');

  // 7. Type the panel's exact QR payload and submit.
  const payload = `Z|1|1/1|600x400x18|Birch 18mm`;
  await page.getByLabel('Enter panel code').fill(payload);
  await page.getByText('Submit Code').click();

  // 8. Assert the row flips to Produced.
  await expect(page.getByTestId(`production-status-${rowKey}`)).toHaveText('Produced');
  await expect(page.getByTestId('production-progress')).toHaveText('1 / 1 produced');

  // 9. Stub showSaveFilePicker to force the <a download> fallback.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 10. Export Packing Slip (PDF) and assert non-zero PDF bytes.
  await page.getByText('Export Packing Slip (PDF)').first().click();
  await page.waitForFunction(() => {
    return !!(window as { __zilventorPackingSlipPdfBytes?: Uint8Array }).__zilventorPackingSlipPdfBytes;
  }, undefined, { timeout: 10_000 });

  const header = await page.evaluate(() => {
    const b = (globalThis as { __zilventorPackingSlipPdfBytes?: Uint8Array }).__zilventorPackingSlipPdfBytes;
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
