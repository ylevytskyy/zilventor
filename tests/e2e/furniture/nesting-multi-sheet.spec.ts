import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T-5e-2 — many panels → ≥ 2 sheets, all cut-list item numbers visible.
 *
 * Seeds 10 large distinct panels (each close to half a 2440×1220 sheet) so the
 * nesting algorithm must spill onto at least 2 sheets. Then cross-checks that
 * every cut-list row's item number appears as a label in the Nesting tab.
 */
test('T-5e-2: many panels → ≥ 2 sheets, all #item labels visible across sheets', async ({ page }) => {
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

  // 2. Add a material with sheet stock (2440×1220mm).
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

  // 10 large distinct panels — each ~1100mm wide, close to the 1220mm sheet width.
  // With kerf=3, roughly 2 panels fit per sheet horizontally, so 10 panels → ~5 sheets.
  const panelDims = [
    { length: 1100, width: 580 },
    { length: 1050, width: 560 },
    { length: 1000, width: 540 },
    { length: 950, width: 520 },
    { length: 900, width: 500 },
    { length: 850, width: 480 },
    { length: 800, width: 460 },
    { length: 750, width: 440 },
    { length: 700, width: 420 },
    { length: 650, width: 400 },
  ];

  // 3. Seed 10 panel parts and place as components.
  for (let i = 1; i <= 10; i++) {
    const dim = panelDims[i - 1];
    await seedAssemblyPanelPart(page, {
      partPath: `panels/mp${i}.zipt`,
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
        id: `MC${idx}`,
        partPath: `panels/mp${idx}.zipt`,
        position: { x: idx * 1200, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }, i);
  }

  // 4. Wait for all 10 components.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 10;
  });

  // 5. Load panel specs into the cut-list cache.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 6. Generate Nest.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toBeVisible();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toHaveCount(0);

  // 7. Open Nesting tab and verify ≥ 2 sheets.
  await page.getByLabel('Nesting tab').click();

  const sheetCount = await page.locator('[data-nesting-sheet]').count();
  expect(sheetCount).toBeGreaterThanOrEqual(2);

  // 8. All 10 distinct item numbers (#1..#10) must be visible across the sheets.
  //    (Each panel is distinct so the cut list produces 10 rows with itemNumbers 1..10.)
  for (let n = 1; n <= 10; n++) {
    await expect(page.getByText(`#${n}`, { exact: true }).first()).toBeVisible();
  }
});
