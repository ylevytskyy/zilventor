import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T33 (sub-project 4c, Phase 12): place 4 cubes (same partPath); set palette
 * `Maple` and assign it to 2 of them. Expect two BOM rows (no-color QTY 2 and
 * Maple QTY 2). Then verify item numbers persist across an OPFS round-trip.
 */
test('T33 — BOM splits identical parts by color and persists item numbers', async ({ page }) => {
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
    for (let i = 0; i < 4; i++) {
      s.addComponent({
        id: `C${i}`, partPath: 'parts/cube.zipt',
        position: { x: i * 80, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
    s.setAssemblyPaletteColor('Maple', '#d4a574');
    w.__zilventorStore.getState().setComponentColor('C2', { kind: 'palette', name: 'Maple' });
    w.__zilventorStore.getState().setComponentColor('C3', { kind: 'palette', name: 'Maple' });
  });

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 4;
  });

  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();

  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();
  const rows = bomTable.locator('tbody tr');
  await expect(rows).toHaveCount(2);

  // Find the two rows by their Color cell content (col 5, 0-indexed).
  const noColorRow = rows.filter({ has: page.locator('td:nth-child(6):text("—")') }).first();
  const mapleRow = rows.filter({ has: page.locator('td:nth-child(6):text("Maple")') }).first();
  await expect(noColorRow.locator('td').nth(3)).toHaveText('2');
  await expect(mapleRow.locator('td').nth(3)).toHaveText('2');

  // Wait for autosave to write the .ziasm.
  const autosavedName = await page.evaluate(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly.name as string) + '.ziasm';
  });
  await expect.poll(async () => {
    return await page.evaluate(async (name) => {
      const w = window as any;
      try {
        const opfs = await w.__zilventorGetOpfs();
        const bytes = await opfs.read(name);
        return bytes.length;
      } catch { return 0; }
    }, autosavedName);
  }, { timeout: 5_000 }).toBeGreaterThan(0);

  // Round-trip through OPFS — the autosave merge populates bomItemNumbers in
  // the persisted bytes even though the live store map is empty until the
  // pre-pack merge runs.
  const after = await page.evaluate(async (name) => {
    const w = window as any;
    w.__zilventorStore.getState().setActiveDocument(null);
    const opfs = await w.__zilventorGetOpfs();
    const bytes = await opfs.read(name);
    const doc = await w.__zilventorUnpackAssembly(bytes);
    return doc.bomItemNumbers as Record<string, number>;
  }, autosavedName);

  expect(Object.keys(after).sort()).toEqual([
    'parts/cube.zipt::none',
    'parts/cube.zipt::palette:Maple',
  ]);
  // Item numbers are 1 and 2 (in some order).
  expect(new Set(Object.values(after))).toEqual(new Set([1, 2]));
});
