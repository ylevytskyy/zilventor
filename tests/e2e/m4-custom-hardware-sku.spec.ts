/**
 * E2E: M4 Slice D — custom hardware SKU import.
 *
 * Flow:
 *   A. New assembly.
 *   B. Open the HardwareDialog via Furniture → "Add Hardware".
 *   C. Stub window.showOpenFilePicker (FSA API — present in Chromium) to
 *      return a fake handle containing the fixture JSON, so pickFile() picks
 *      it up without needing a real OS file-chooser.
 *   D. Click "Import SKU…" — the dialog calls parseCustomHardwareImport →
 *      bus.execute(ImportCustomHardwareCommand) → addCustomHardware store action.
 *   E. Assert via STORE: activeAssembly.customHardware contains the imported id.
 *   F. Assert: 0 browser console errors.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/custom-hardware-sku.json');

test(
  'M4-D import custom hardware SKU → appears in store activeAssembly.customHardware, 0 console errors',
  async ({ page }) => {
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

    // ── B. Open the Hardware dialog ──────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Furniture' }).click();
    await page.getByRole('button', { name: 'Add Hardware' }).click();
    await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();

    // ── C. Stub showOpenFilePicker before clicking Import SKU… ───────────────────
    // pickFile() (fsaFallback.ts) uses showOpenFilePicker when it's available
    // (Chromium). We inject a fake handle so the import resolves synchronously
    // without triggering the real OS picker.
    const jsonContent = readFileSync(FIXTURE_PATH, 'utf-8');
    await page.evaluate((content: string) => {
      const fakeFile = {
        name: 'custom-hardware-sku.json',
        text: async () => content,
      };
      const fakeHandle = { getFile: async () => fakeFile };
      (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [
        fakeHandle,
      ];
    }, jsonContent);

    // ── D. Click "Import SKU…" ───────────────────────────────────────────────────
    await page.getByRole('button', { name: /import sku/i }).click();

    // ── E. Wait for the store to receive the imported entry ──────────────────────
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeAssembly: { customHardware?: Array<{ id: string }> } | null;
            };
          };
        };
        return (
          (w.__zilventorStore.getState().activeAssembly?.customHardware?.length ?? 0) > 0
        );
      },
      undefined,
      { timeout: 30_000 },
    );

    // Assert the specific imported id is present.
    const ids = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeAssembly: { customHardware?: Array<{ id: string }> } | null;
          };
        };
      };
      return (
        w.__zilventorStore.getState().activeAssembly?.customHardware ?? []
      ).map((e) => e.id);
    });
    expect(ids).toContain('e2e-acme-pull-128');

    // ── F. 0 browser console errors ─────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during M4-D custom hardware SKU import').toHaveLength(0);
  },
);
