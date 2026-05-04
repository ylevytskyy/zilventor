import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T-5e-3 — stale banner round-trip.
 *
 * 1. Place 1 panel, generate nest, open Nesting tab → no stale banner.
 * 2. Add a 2nd panel → stale banner appears.
 * 3. Click Regenerate → banner clears and 2 panels are shown.
 */
test('T-5e-3: edit cut-list → stale banner → Regenerate clears it', async ({ page }) => {
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

  // 3. Seed panel 1 + place.
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/stale-p1.zipt',
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
      id: 'SC1',
      partPath: 'panels/stale-p1.zipt',
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

  // 4. Load cut-list specs so nesting has rows to pack.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 5. Generate Nest.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toBeVisible();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toHaveCount(0);

  // 6. Open Nesting tab — no stale banner yet.
  await page.getByLabel('Nesting tab').click();
  await expect(page.locator('[data-nesting-sheet]')).toHaveCount(1);
  await expect(page.getByLabel('Nest stale')).toHaveCount(0);

  // 7. Add a 2nd distinct panel to change the cut list.
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/stale-p2.zipt',
    partName: 'Panel 2',
    length: 800,
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
      id: 'SC2',
      partPath: 'panels/stale-p2.zipt',
      position: { x: 700, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 8. Load cut-list specs for the new panel so the fingerprint changes.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 9. The Nesting tab is already open; wait for the stale banner to appear
  //    (NestingTab recomputes the fingerprint asynchronously via SHA-256).
  await expect(page.getByLabel('Nest stale')).toBeVisible({ timeout: 10_000 });

  // 10. Regenerate clears the banner and shows 2 panels.
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByLabel('Nest stale')).toHaveCount(0);
  await expect(page.locator('[data-nesting-panel]')).toHaveCount(2);
});
