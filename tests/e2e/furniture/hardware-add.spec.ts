import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5c-1 — Add Hardware: place 35mm cup hinge, verify OPFS file + cut list row', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Open Furniture → Hardware → Add Hardware.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();

  // 3. Dialog opens; default is Hinges, first SKU selected.
  await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();
  const radioFull = page.getByRole('radio', { name: /35mm Cup Hinge.*Full Overlay/i });
  await expect(radioFull).toBeChecked();

  // 4. Click OK.
  await page.getByRole('button', { name: /^ok$/i }).click();
  await expect(page.getByRole('dialog', { name: /hardware/i })).toHaveCount(0);

  // 5. Wait for component to appear.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // 6. Assert OPFS file exists.
  const fileExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      // @ts-expect-error iterator typing
      for await (const [name] of root.entries()) {
        if (name === 'hardware') return true;
      }
    } catch { /* */ }
    return false;
  });
  expect(fileExists).toBe(true);

  // 7. Open Cut List tab and verify Hardware section shows 1 row.
  await page.getByRole('button', { name: 'Cut List tab' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { cutListTabActive: boolean } } };
    return w.__zilventorStore.getState().cutListTabActive;
  });
  await expect(page.getByText('35mm Cup Hinge — Full Overlay')).toBeVisible();
  await expect(page.getByText('1')).toBeVisible();
});

test('T-5c-2 — same SKU placed twice → Hardware table shows 1 row with Qty=2', async ({ page }) => {
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

  // Add hinge twice via Qty stepper set to 2.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();
  await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();
  await page.getByRole('button', { name: /increment qty/i }).click();
  await page.getByRole('button', { name: /^ok$/i }).click();

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 2;
  });

  // Open Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { cutListTabActive: boolean } } };
    return w.__zilventorStore.getState().cutListTabActive;
  });

  // Exactly 1 row for the hinge SKU with Qty=2.
  const rows = await page.getByRole('row').all();
  const hingeRows = rows.filter(async (r) => (await r.textContent())?.includes('35mm Cup Hinge'));
  expect(hingeRows).toHaveLength(1);
  await expect(page.getByText('2')).toBeVisible();
});

test('T-5c-3 — Ctrl+Z round-trips a hardware placement', async ({ page }) => {
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

  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();
  await page.getByRole('button', { name: /^ok$/i }).click();

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // Verify component count before undo.
  const beforeUndo = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    return { components: w.__zilventorStore.getState().activeAssembly.components.length };
  });
  expect(beforeUndo.components).toBe(1);

  // Ctrl+Z.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    return w.__zilventorStore.getState().activeAssembly.components.length === 0;
  });

  // Verify file deleted.
  const hardwareDirExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle('hardware', { create: false });
      // If we get here, directory exists; check if it has files.
      const dir = await root.getDirectoryHandle('hardware');
      let count = 0;
      // @ts-expect-error iterator typing
      for await (const _ of dir.entries()) count++;
      return count;
    } catch {
      return 0;
    }
  });
  expect(hardwareDirExists).toBe(0);

  // Hardware table should show 0 rows.
  await page.getByRole('button', { name: 'Cut List tab' }).click();
  await expect(page.getByText(/no hardware/i)).toBeVisible();
});
