import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

/**
 * T27 — recursive cut list: outer assembly has 2 instances of an inner
 * sub-assembly, which itself contains 2 distinct panels.
 *
 * Tree:
 *   parts/t27-panel-a.zipt  (600×400, birch)
 *   parts/t27-panel-b.zipt  (800×400, birch)
 *   inner.ziasm  → { pa: panel-a, pb: panel-b }
 *   outer  (top assembly) → { S0: inner.ziasm, S1: inner.ziasm }
 *
 * Expected cut list after recursive roll-up:
 *   Row 0: 600×400 Birch 18mm — QTY 2 (1 per sub-asm instance)
 *   Row 1: 800×400 Birch 18mm — QTY 2
 */
test('T27 — recursive cut list rolls up panels across nested .ziasm', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly (top-level outer).
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add shared material so cut list can resolve names.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed two distinct leaf panel parts to OPFS.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t27-panel-a.zipt',
    partName: 't27-panel-a',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t27-panel-b.zipt',
    partName: 't27-panel-b',
    length: 800, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Seed inner sub-assembly: 2 distinct panels.
  const innerDoc = makeSubAsmDoc('inner', [
    { id: 'pa', partPath: 'parts/t27-panel-a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'parts/t27-panel-b.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'inner.ziasm', innerDoc);

  // 5. Place 2 instances of inner.ziasm in the top-level assembly.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'S0', partPath: 'inner.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'S1', partPath: 'inner.ziasm', position: { x: 0, y: 500, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 6. Load sub-assembly docs into the store so the recursive walker can see them.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadSubAsmTree?: () => Promise<void> };
    await w.__zilventorLoadSubAsmTree?.();
  });

  // 7. Load panel specs from OPFS for all leaf parts.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 8. Open Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 9. Assert: 2 rows, each QTY=2.
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });

  // Both rows should have QTY=2 (1 per sub-assembly instance × 2 instances).
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2');
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('2');
});
