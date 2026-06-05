/**
 * E2E: File→Open shows the blocking FileOpenOverlay during the open and
 * removes it once the import completes. The fake file's arrayBuffer() is
 * delayed so the overlay is observably visible (the fixture parses fast).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('file-open overlay appears during open and clears after import', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  const stepBytes = readFileSync(STEP);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'two-bodies.step',
        arrayBuffer: async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return new Uint8Array(bytes).buffer;
        },
      };
      (window as any).showOpenFilePicker = async () => [{ getFile: async () => fakeFile }];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /open/i }).click();

  const overlay = page.getByTestId('file-open-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('two-bodies.step');

  await page.waitForFunction(
    () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
    undefined,
    { timeout: 60_000 },
  );

  await expect(overlay).toBeHidden();
  const fileOpen = await page.evaluate(
    () => (window as any).__zilventorStore?.getState().fileOpen ?? null,
  );
  expect(fileOpen).toBeNull();
});
