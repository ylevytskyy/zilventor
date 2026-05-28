import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

test('load a stand-alone STEP file: viewport renders the imported part', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __zilventorImportStepFromBytes?: unknown }).__zilventorImportStepFromBytes,
  ));

  const stepBytes = readFileSync(
    resolve(__dirname, '../../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step'),
  );

  const summary = await page.evaluate(
    async ([bytes]: [number[]]) => {
      const w = window as unknown as {
        __zilventorImportStepFromBytes: (b: number[], f: string) => Promise<{ partId: string; partName: string }>;
      };
      return await w.__zilventorImportStepFromBytes(bytes, 'cube-10mm.step');
    },
    [Array.from(stepBytes)] as [number[]],
  );

  expect(summary.partName).toBe('cube-10mm');
  expect(summary.partId).toMatch(/[0-9a-f-]{36}/);

  // The part is in the store as activePart, and the BrowserPane shows its name.
  await expect(page.getByText('cube-10mm', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

  // Sanity: feature tree has 7 origin features + 1 ImportedFeature.
  const treeInfo = await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore?: { getState: () => { activePart: { featureTree: unknown[] } | null } };
    }).__zilventorStore;
    if (!store) return null;
    const part = store.getState().activePart;
    return part ? { featureCount: part.featureTree.length } : null;
  });
  expect(treeInfo?.featureCount).toBe(8); // 7 origin + 1 ImportedFeature
});
