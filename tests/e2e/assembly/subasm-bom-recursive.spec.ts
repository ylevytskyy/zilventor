import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T42 (4d Phase 11b): the recursive BOM aggregator + the CSV exporter
 * walk into multi-level sub-assemblies.
 *
 * Tree:
 *   parts/cube.zipt (panel)
 *     ↑ × 2
 *   drawer.ziasm
 *     ↑ × 2
 *   cabinet.ziasm
 *     ↑ × 3 (top assembly)
 *
 * Total panel leaves = 3 × 2 × 2 = 12.
 */
test('T42 — 3-level sub-asm BOM aggregates to qty=12 + CSV export', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // drawer.ziasm: 2 panels.
  const drawer = makeSubAsmDoc('drawer', [
    { id: 'pa', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'parts/cube.zipt',
      position: { x: 80, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);

  // cabinet.ziasm: 2 drawers.
  const cabinet = makeSubAsmDoc('cabinet', [
    { id: 'da', partPath: 'drawer.ziasm',
      position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'db', partPath: 'drawer.ziasm',
      position: { x: 0, y: 200, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'cabinet.ziasm', cabinet);

  // Top assembly: 3 cabinets.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cabinet$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
    await page.waitForFunction(
      (expected) => {
        const w = window as any;
        return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === expected;
      },
      i + 1,
    );
  }

  // Hydrate the recursive cache.
  await page.evaluate(async () => {
    const w = window as any;
    await w.__zilventorLoadSubAsmTree();
  });

  // 3 cabinets × 2 drawers × 2 panels = 12 leaves.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorComponentPathToLeafCount?.([]) ?? -1;
    });
  }, { timeout: 10_000 }).toBe(12);

  // BomTable shows 1 row qty=12 against parts/cube.zipt.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.locator('[aria-label="BOM panel"]').getByRole('button', { name: /^bom$/i }).click();
  const bomTable = page.locator('[data-testid=bom-table]');
  await expect(bomTable).toBeVisible();

  const rows = bomTable.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').nth(3)).toHaveText('12');
  // Part Name column must resolve the real seeded part doc name ("cube"),
  // not the '(missing part)' placeholder — the partInfo cache must recurse
  // into nested .ziasm sub-assemblies the same way the leaf-path walk does.
  await expect(rows.first().locator('td').nth(4)).toHaveText('cube');

  // Export CSV (mock the save picker with AbortError so the dev hook
  // captures bytes without a save dialog).
  await page.evaluate(() => {
    (window as any).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });
  await bomTable.getByRole('button', { name: /^export csv$/i }).click();

  const csv = await page.evaluate(() => {
    const w = window as any;
    const bytes = w.__zilventorBomCsvBytes ? w.__zilventorBomCsvBytes() : null;
    return bytes ? new TextDecoder().decode(bytes) : null;
  });
  expect(csv).not.toBeNull();
  expect(csv).toContain('Item#,Part #,Description,QTY,Part Name,Color,Part Path\n');
  // One row, qty=12, no color, parts/cube.zipt, Part Name resolved to the
  // real seeded name ("cube") — nested part references must not fall back
  // to '(missing part)'.
  expect(csv).toMatch(/\n\d+,[^,]*,[^,]*,12,cube,,parts\/cube\.zipt\n/);
});
