import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

test('import single part: cube STEP + JSON sidecar → .zipt in OPFS', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __zilventorImportFromFiles?: unknown }).__zilventorImportFromFiles));

  const fixtureDir = resolve(__dirname, '../fixtures/inventor-export/single-part');
  const partJson = readFileSync(resolve(fixtureDir, 'SidePanel.ipt.json'), 'utf-8');
  const stepBytes = readFileSync(resolve(fixtureDir, 'SidePanel.step'));

  const summary = await page.evaluate(
    async ([json, step]: [string, number[]]) => {
      const w = window as unknown as {
        __zilventorImportFromFiles: (
          files: Record<string, string | number[]>,
          target: string,
        ) => Promise<{
          partsImported: number;
          assembliesImported: number;
          skipped: number;
          errors: { path: string; error: string }[];
        }>;
      };
      return await w.__zilventorImportFromFiles(
        { 'SidePanel.ipt.json': json, 'SidePanel.step': step },
        'imported-e2e-single-part',
      );
    },
    [partJson, Array.from(stepBytes)] as [string, number[]],
  );

  expect(summary.partsImported).toBe(1);
  expect(summary.assembliesImported).toBe(0);
  expect(summary.errors).toEqual([]);
});
