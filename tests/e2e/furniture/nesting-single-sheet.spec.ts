import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T-5e-1 — 6 panels of one material → 1 sheet with 6 #item labels.
 *
 * Seeds 6 panel parts (600×400mm each, birch18 material with sheet stock
 * 2440×1220mm). Generates a nest with kerf=3, then opens the Nesting tab
 * and asserts: 1 sheet, 6 panels, all #1..#6 labels visible.
 */
test('T-5e-1: 6 panels of one material → 1 sheet with 6 #item labels', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly via ribbon.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add a material with sheet stock fields so the nesting algorithm can pack.
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

  // Panel dimensions: each panel is distinct so each gets its own cut-list row (#1..#6).
  const panelDims = [
    { length: 600, width: 400 },
    { length: 550, width: 380 },
    { length: 500, width: 350 },
    { length: 450, width: 320 },
    { length: 400, width: 300 },
    { length: 350, width: 280 },
  ];

  // 3. Seed 6 panel parts to OPFS and place each as a component.
  for (let i = 1; i <= 6; i++) {
    const dim = panelDims[i - 1];
    await seedAssemblyPanelPart(page, {
      partPath: `panels/p${i}.zipt`,
      partName: `Panel ${i}`,
      length: dim.length,
      width: dim.width,
      thickness: 18,
      materialId: 'birch18',
      grain: 'length',
      materials: [{ id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c' }],
    });
    await page.evaluate((idx) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addComponent(c: unknown): void } };
      };
      w.__zilventorStore.getState().addComponent({
        id: `C${idx}`,
        partPath: `panels/p${idx}.zipt`,
        position: { x: idx * 700, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }, i);
  }

  // 4. Wait for all 6 components in the assembly.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 6;
  });

  // 5. Load panel specs from OPFS so useCutListResult returns rows.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Open Furniture tab → Generate Nest → kerf 3 → OK.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toBeVisible();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toHaveCount(0);

  // 7. Open Nesting tab.
  await page.getByLabel('Nesting tab').click();

  // 8. Assert: 1 sheet, 6 panels, labels #1..#6.
  const sheets = page.locator('[data-nesting-sheet]');
  await expect(sheets).toHaveCount(1);

  const panels = page.locator('[data-nesting-panel]');
  await expect(panels).toHaveCount(6);

  for (let i = 1; i <= 6; i++) {
    await expect(page.getByText(`#${i}`, { exact: true })).toBeVisible();
  }
});
