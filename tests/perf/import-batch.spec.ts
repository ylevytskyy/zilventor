import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('batch import 50 parts + 10 assemblies under perf budget', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __zilventorImportFromFiles?: unknown }).__zilventorImportFromFiles));

  const fixtureDir = resolve(__dirname, 'fixtures/inventor-export-batch');
  const files: Record<string, string | number[]> = {};
  for (const f of readdirSync(fixtureDir)) {
    const path = resolve(fixtureDir, f);
    if (f.endsWith('.json')) files[f] = readFileSync(path, 'utf-8');
    else files[f] = Array.from(readFileSync(path));
  }

  const t0 = Date.now();
  const summary = await page.evaluate(
    async (f: Record<string, string | number[]>) => {
      const w = window as unknown as {
        __zilventorImportFromFiles: (
          files: Record<string, string | number[]>,
          target: string,
        ) => Promise<{ partsImported: number; assembliesImported: number; skipped: number; errors: { path: string; error: string }[] }>;
      };
      return await w.__zilventorImportFromFiles(f, 'imported-batch-perf');
    },
    files,
  );
  const elapsed = Date.now() - t0;

  expect(summary.partsImported).toBe(50);
  expect(summary.assembliesImported).toBe(10);
  expect(summary.errors).toEqual([]);
  // Threshold calibrated on local dev hardware. CI may need a generous budget;
  // tighten in a follow-up after running on the real CI box.
  console.log(`[T25 perf] batch import 50+10 took ${elapsed}ms`);
  expect(elapsed).toBeLessThan(60_000);
});
