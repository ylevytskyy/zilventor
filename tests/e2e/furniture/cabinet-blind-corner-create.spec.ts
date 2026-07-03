import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * E2E: M4 Slice E — blind corner cabinet create + undo.
 *
 * Flow:
 *   A. New assembly.
 *   B. Seed two materials (carcass 18mm + back 6mm) so the dialog can
 *      auto-select them and the OK button is not disabled.
 *   C. Furniture tab → "Blind Corner Cabinet" ribbon button → dialog opens.
 *   D. Click OK (default params: width=900, depth=600, height=720,
 *      openingWidth=450, blindSide=left, shelfCount=1).
 *   E. Wait for the cabinet component to appear in activeAssembly.components.
 *   F. Assert via STORE:
 *      - exactly 1 component in the root assembly
 *      - that component's partPath ends in ".ziasm" and contains "Blind Corner Cabinet"
 *        (non-vacuous: fails if the cabinet was never actually created)
 *   G. Assert: 0 browser console errors (ResizeObserver filtered out).
 *
 * Test 2 verifies Ctrl+Z removes the placed cabinet (components → 0).
 */

test('T-m4e-blind-1 — create a blind corner cabinet from Furniture tab', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Blind Corner Cabinet' }).click();
  await expect(page.getByRole('dialog', { name: 'Blind Corner Cabinet' })).toBeVisible();

  // ── D+E. Submit with defaults, poll the settled end state ────────────────────
  // BlindCornerCabinetDialog's OK handler (handleOk) awaits the kernel-heavy
  // CreateCabinetCommand before flipping the dialog-closed state:
  //   await dialog.onSubmit(params); setDialog(null);
  // so dialog-close and the store's cabinet-component mutation are gated on the
  // same kernel build and land together. Under CPU contention that build can
  // exceed Playwright's default 5s expect timeout — direct repro: 1/60 red at
  // workers=6/repeat-each=15 under a synthetic CPU-load generator, failing at
  // exactly this `toHaveCount(0)` line with the dialog still present. Poll the
  // full settled post-condition (dialog closed AND component present) to a
  // generous deadline instead of time-boxing the dialog-close transition alone,
  // mirroring the T-6-20 / material-hatch poll-full-post-condition fix pattern.
  await page.getByRole('button', { name: 'OK' }).click();

  let settled = { dialogClosed: false, componentCount: 0 };
  await expect
    .poll(
      async () => {
        settled = {
          dialogClosed: (await page.getByRole('dialog', { name: 'Blind Corner Cabinet' }).count()) === 0,
          componentCount: await page.evaluate(() => {
            const w = window as unknown as {
              __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } };
            };
            return w.__zilventorStore.getState().activeAssembly?.components.length ?? 0;
          }),
        };
        return settled.dialogClosed && settled.componentCount >= 1;
      },
      {
        timeout: 60_000,
        message: 'Dialog must close and the cabinet component must appear in the store (kernel-heavy CreateCabinetCommand gates both)',
      },
    )
    .toBe(true);

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

  // Non-vacuous: the component is a .ziasm and its name contains "Blind Corner Cabinet".
  // This fails if the command ran a base-cabinet or corner-cabinet template instead.
  expect(result.partPath).toMatch(/Blind Corner Cabinet.*\.ziasm$/);

  // ── G. 0 browser console errors ──────────────────────────────────────────────
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
  );
  expect(realErrors, 'no browser errors during blind corner cabinet creation').toHaveLength(0);
});

test('T-m4e-blind-2 — undo removes blind corner cabinet', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Blind Corner Cabinet' }).click();
  await expect(page.getByRole('dialog', { name: 'Blind Corner Cabinet' })).toBeVisible();
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
  expect(realErrors, 'no browser errors during blind corner cabinet undo').toHaveLength(0);
});
