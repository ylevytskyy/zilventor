import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T25 — cut list grain normalization.
 *
 * Tests two scenarios in one assembly:
 *
 *  grain=none: a 600×400 panel and a 400×600 panel (swapped L/W) should
 *  normalize to the same key (L=max=600, W=min=400) and merge into 1 row
 *  with QTY=2.
 *
 *  grain=length: the same two dimension combos (600×400 and 400×600) must
 *  stay distinct because grain direction is fixed, yielding 2 separate rows.
 *
 *  Total after both phases: 3 rows (1 merged + 2 distinct).
 */
test('T25 — grain=none swapped L/W merges; grain=length stays distinct', async ({ page }) => {
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

  // 2. Add shared material to assembly registry.
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

  // 3. Seed grain=none parts to OPFS.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t25-g0a.zipt',
    partName: 't25-g0a',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'none',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t25-g0b.zipt',
    partName: 't25-g0b',
    length: 400, width: 600, thickness: 18,
    materialId: 'm-birch', grain: 'none',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Place 1 of each grain=none part.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addComponent(c: unknown): void };
      };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t25-g0a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t25-g0b.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 5. Load panel specs and open cut list.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 6. grain=none: 2 placements with swapped L/W → 1 merged row, QTY=2.
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(1, { timeout: 10_000 });

  // Normalized: L=max(600,400)=600, W=min(600,400)=400.
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText('600');
  await expect(rows.nth(0).locator('td').nth(4)).toHaveText('400');
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2');

  // 7. Seed grain=length parts with swapped L/W.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t25-glA.zipt',
    partName: 't25-glA',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t25-glB.zipt',
    partName: 't25-glB',
    length: 400, width: 600, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 8. Place 1 of each grain=length part.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addComponent(c: unknown): void };
      };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C2', partPath: 'parts/t25-glA.zipt', position: { x: 0, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C3', partPath: 'parts/t25-glB.zipt', position: { x: 700, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 4;
  });

  // 9. Reload panel specs for the newly added parts.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 10. Assert: 3 total rows — 1 grain=none merged + 2 grain=length distinct.
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
});
