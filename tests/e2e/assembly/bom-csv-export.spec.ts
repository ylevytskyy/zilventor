import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T36 (sub-project 4c, Phase 12): clicking Export CSV on the BOM table writes
 * the expected CSV bytes. We verify by capturing through the
 * `__zilventorBomCsvBytes` dev hook (set by ExportBomCsvCommand) — the save
 * dialog itself is mocked to throw AbortError, simulating a user cancel,
 * which still triggers the dev-hook capture.
 */
test('T36 — Export CSV produces the expected CSV bytes', async ({ page }) => {
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
    s.addComponent({ id: 'C0', partPath: 'parts/cube.zipt', position: { x: 0,  y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.addComponent({ id: 'C1', partPath: 'parts/cube.zipt', position: { x: 80, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.addComponent({ id: 'C2', partPath: 'parts/cube.zipt', position: { x: 160, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    s.setAssemblyPaletteColor('Maple', '#d4a574');
    w.__zilventorStore.getState().setComponentColor('C2', { kind: 'palette', name: 'Maple' });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 3;
  });

  // Wait for the part-name cache to populate with 'cube' (resolved from the
  // seeded manifest). Without this, the CSV would contain '(missing part)'.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();
  await expect(page.locator('[data-testid=bom-table]')).toBeVisible();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-testid=bom-table] tbody tr td:nth-child(3)');
      return Array.from(cells).map((c) => (c.textContent ?? '').trim());
    });
  }, { timeout: 10_000 }).toEqual(['cube', 'cube']);

  // Mock showSaveFilePicker to immediately cancel.
  await page.evaluate(() => {
    (window as any).showSaveFilePicker = async () => {
      const err = new DOMException('cancelled', 'AbortError');
      throw err;
    };
  });

  await page.locator('[data-testid=bom-table]').getByRole('button', { name: /^export csv$/i }).click();

  const csv = await page.evaluate(() => {
    const w = window as any;
    const bytes = w.__zilventorBomCsvBytes ? w.__zilventorBomCsvBytes() : null;
    if (!bytes) return null;
    return new TextDecoder().decode(bytes);
  });
  expect(csv).not.toBeNull();
  expect(csv).toContain('Item#,QTY,Part Name,Color,Part Path\n');
  // Two rows: no-color QTY 2, Maple QTY 1, both cube.
  expect(csv).toMatch(/\n\d+,2,cube,,parts\/cube\.zipt\n/);
  expect(csv).toMatch(/\n\d+,1,cube,Maple,parts\/cube\.zipt\n/);
});
