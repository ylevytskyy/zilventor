import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';
import { waitForAutosave } from '../helpers/waitForAutosave';

const STEP_FILE_PATH = resolve(
  __dirname,
  '../../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step',
);

test('import STEP into assembly via File → Open: component appears and persists on reload', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New empty assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Wait for the dev hook to be ready and invoke it
  await page.waitForFunction(() => Boolean((window as any).__zilventorImportStepIntoAssembly));

  const stepBytes = readFileSync(STEP_FILE_PATH);
  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorImportStepIntoAssembly: (b: number[], f: string) => Promise<{ componentCount: number; statusMessage: string }>;
      };
      return await w.__zilventorImportStepIntoAssembly(bytes, 'cube-10mm.step');
    },
    [Array.from(stepBytes)] as [number[]],
  );

  expect(summary.componentCount).toBe(1);
  expect(summary.statusMessage).toContain('inserted into assembly');

  // 3. Assembly mesh tessellation (proves real BREP path)
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 20_000 }).toBeGreaterThan(0);

  // 4. Status bar visible
  await expect(page.getByText(/inserted into assembly/i)).toBeVisible({ timeout: 5_000 });

  // 5. Wait for autosave to write the assembly to OPFS, then reload
  await waitForAutosave(page);

  await page.reload();
  await waitForKernelReady(page);

  // Component still present after reload (autosave round-trip proof)
  await page.waitForFunction(() => {
    const w = window as any;
    const doc = w.__zilventorStore?.getState().activeDocument;
    return doc?.kind === 'assembly' && doc.document.components.length > 0;
  }, { timeout: 15_000 });

  const afterReload = await page.evaluate(() => {
    const w = window as any;
    const doc = w.__zilventorStore?.getState().activeDocument;
    return doc?.kind === 'assembly' ? doc.document.components.length : -1;
  });
  expect(afterReload).toBe(1);
});

test('import STEP into assembly via AssemblyTab button: component appears', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New empty assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Switch to Assembly tab and verify button is present and enabled
  await page.getByRole('tab', { name: /assembly/i }).click();

  const insertBtn = page.getByRole('button', { name: /insert from step/i });
  await expect(insertBtn).toBeVisible();
  await expect(insertBtn).not.toBeDisabled();

  // 3. Inject fake file picker before clicking button
  const stepBytes = readFileSync(STEP_FILE_PATH);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'cube-10mm.step',
        arrayBuffer: async () => new Uint8Array(bytes).buffer,
      };
      const fakeHandle = { getFile: async () => fakeFile };
      (window as any).showOpenFilePicker = async () => [fakeHandle];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  await insertBtn.click();

  // 4. Wait for component to appear in store
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      const doc = w.__zilventorStore?.getState().activeDocument;
      return doc?.kind === 'assembly' ? doc.document.components.length : 0;
    });
  }, { timeout: 20_000 }).toBe(1);

  // 5. Proves real BREP tessellation path
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorAssemblyGeomCacheSize?.() ?? -1;
    });
  }, { timeout: 20_000 }).toBeGreaterThan(0);
});
