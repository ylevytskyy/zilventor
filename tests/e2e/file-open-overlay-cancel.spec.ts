/**
 * E2E: Clicking Cancel during an open dismisses the overlay, restarts the
 * kernel worker (status 'Open cancelled', kernelReady true), and does NOT pop
 * an error dialog when the abandoned in-flight open later rejects on the dead
 * worker. The fake file's arrayBuffer() is delayed 5s to keep the open in-flight.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('Cancel during open dismisses overlay, restarts kernel, shows no error', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  const stepBytes = readFileSync(STEP);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'two-bodies.step',
        arrayBuffer: async () => {
          await new Promise((r) => setTimeout(r, 5000)); // keep the open in-flight
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

  await overlay.getByRole('button', { name: /cancel/i }).click();

  // Overlay dismissed immediately on cancel.
  await expect(overlay).toBeHidden();

  // handleRestart resolves (worker respawned) then status is set last → proves
  // the restart completed. kernelReady must be true again.
  await page.waitForFunction(
    () => (window as any).__zilventorStore?.getState().statusMessage === 'Open cancelled',
    undefined,
    { timeout: 30_000 },
  );
  const kernelReady = await page.evaluate(
    () => (window as any).__zilventorStore?.getState().kernelReady,
  );
  expect(kernelReady).toBe(true);

  // Let the abandoned 5s arrayBuffer resolve & reject on the dead worker.
  await page.waitForTimeout(5500);
  await expect(page.getByRole('alertdialog', { name: 'Error' })).toHaveCount(0);
  expect(pageErrors).toHaveLength(0);
});
