import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * E2E: M4 Slice E — diagonal corner cabinet create + undo.
 *
 * Flow:
 *   A. New assembly.
 *   B. Seed two materials (carcass 18mm + back 6mm) so the dialog can
 *      auto-select them and the OK button is not disabled.
 *   C. Furniture tab → "Diagonal Corner Cabinet" ribbon button → dialog opens.
 *   D. Click OK (default params).
 *   E. Wait for the cabinet component to appear in activeAssembly.components.
 *   F. Assert via STORE:
 *      - exactly 1 component in the root assembly
 *      - that component's partPath ends in ".ziasm" and contains "Diagonal Corner Cabinet"
 *        (non-vacuous: fails if the command ran a base-cabinet or blind-corner template instead)
 *   G. Assert: 0 browser console errors (ResizeObserver + favicon filtered out).
 *      This proves the pentagon outline-prism rendering path does NOT crash the viewport.
 *
 * Test 2 verifies Ctrl+Z removes the placed cabinet (components → 0).
 */

test('T-m4e-diag-1 — create a diagonal corner cabinet from Furniture tab', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(90_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // ── A. New assembly ──────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // ── B. Seed materials ────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  // ── C. Open dialog ───────────────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Diagonal Corner Cabinet' }).click();
  await expect(page.getByRole('dialog', { name: 'Diagonal Corner Cabinet' })).toBeVisible();

  // ── D. Submit with defaults ──────────────────────────────────────────────────
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Diagonal Corner Cabinet' })).toHaveCount(0);

  // ── E. Wait for cabinet component ────────────────────────────────────────────
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
    },
    undefined,
    { timeout: 60_000 },
  );

  // ── F. Assert store ───────────────────────────────────────────────────────────
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activeAssembly: { components: Array<{ partPath: string; visible?: boolean }> } | null;
        };
      };
    };
    const asm = w.__zilventorStore.getState().activeAssembly;
    if (!asm) return { count: -1, partPath: '' };
    return {
      count: asm.components.length,
      partPath: asm.components[0]?.partPath ?? '',
    };
  });

  // Exactly 1 top-level component placed (the cabinet .ziasm).
  expect(result.count).toBe(1);

  // Non-vacuous: the component is a .ziasm and its name contains "Diagonal Corner Cabinet".
  // This fails if the command ran a base-cabinet or blind-corner template instead.
  expect(result.partPath).toMatch(/Diagonal Corner Cabinet.*\.ziasm$/);

  // ── G. 0 browser console errors ──────────────────────────────────────────────
  // Key proof: the pentagon outline-prism rendering path does not crash the viewport.
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
  );
  expect(realErrors, 'no browser errors during diagonal corner cabinet creation').toHaveLength(0);
});

test('T-m4e-diag-2 — undo removes diagonal corner cabinet', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(90_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // New assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Seed materials
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  // Create cabinet
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Diagonal Corner Cabinet' }).click();
  await expect(page.getByRole('dialog', { name: 'Diagonal Corner Cabinet' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();

  // Wait for component to appear
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
    },
    undefined,
    { timeout: 60_000 },
  );

  // Ctrl+Z to undo
  await page.keyboard.press('Control+z');

  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 0;
    },
    undefined,
    { timeout: 30_000 },
  );

  // Undo confirmed — component count is 0
  const componentCount = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeAssembly: { components: unknown[] } | null };
      };
    };
    return w.__zilventorStore.getState().activeAssembly?.components.length ?? -1;
  });
  expect(componentCount).toBe(0);

  const realErrors = consoleErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
  );
  expect(realErrors, 'no browser errors during diagonal corner cabinet undo').toHaveLength(0);
});
