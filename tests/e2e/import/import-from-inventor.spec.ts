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

test('import two-level assembly: Leaf part + Inner asm + Outer asm', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __zilventorImportFromFiles?: unknown }).__zilventorImportFromFiles));

  const fixtureDir = resolve(__dirname, '../fixtures/inventor-export/two-level-asm');
  const leafJson = readFileSync(resolve(fixtureDir, 'Leaf.ipt.json'), 'utf-8');
  const leafStep = readFileSync(resolve(fixtureDir, 'Leaf.step'));
  const innerJson = readFileSync(resolve(fixtureDir, 'Inner.iam.json'), 'utf-8');
  const outerJson = readFileSync(resolve(fixtureDir, 'Outer.iam.json'), 'utf-8');

  const summary = await page.evaluate(
    async ([lj, ls, ij, oj]: [string, number[], string, string]) => {
      const w = window as unknown as {
        __zilventorImportFromFiles: (
          files: Record<string, string | number[]>,
          target: string,
        ) => Promise<{ partsImported: number; assembliesImported: number; skipped: number; errors: { path: string; error: string }[] }>;
      };
      return await w.__zilventorImportFromFiles(
        {
          'Leaf.ipt.json': lj,
          'Leaf.step': ls,
          'Inner.iam.json': ij,
          'Outer.iam.json': oj,
        },
        'imported-e2e-two-level',
      );
    },
    [leafJson, Array.from(leafStep), innerJson, outerJson] as [string, number[], string, string],
  );

  expect(summary.partsImported).toBe(1);
  expect(summary.assembliesImported).toBe(2);
  expect(summary.errors).toEqual([]);

  // Verify the produced .ziasm files exist in OPFS at the expected paths.
  const opfsContents = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const target = await root.getDirectoryHandle('imported-e2e-two-level');
    const names: string[] = [];
    // @ts-expect-error - .keys() is available on FileSystemDirectoryHandle in Chrome
    for await (const k of target.keys()) names.push(k);
    return names.sort();
  });
  expect(opfsContents).toEqual(['Inner.ziasm', 'Leaf.zipt', 'Outer.ziasm'].sort());
});
