import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5b-2 — cut list shows 5 aggregated rows after cabinet creation', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Base Cabinet' }).click();
  await page.getByRole('button', { name: 'OK' }).click();

  // Wait for the async CreateCabinetCommand to finish placing the component.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // Load sub-assembly docs so the recursive walker can descend into the cabinet.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadSubAsmTree?: () => Promise<void> };
    await w.__zilventorLoadSubAsmTree?.();
  });

  // Populate the panel spec cache from OPFS (required for cut list rows).
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // With defaults (shelfCount=1, toekickHeight=100):
  // Left+Right sides share identical dims → 1 row (qty 2)
  // Bottom+Top share identical dims → 1 row (qty 2)
  // Back, Toekick, Shelf 1 are unique → 3 rows
  // Total: 5 aggregated rows
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(5, { timeout: 15_000 });
});
