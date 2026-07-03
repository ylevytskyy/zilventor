import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';
import { waitForAutosave } from './helpers/waitForAutosave';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('multi-body STEP explodes into N components, persists, undoes', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a fresh assembly via the FileTab button (matches real UI path used in other e2e).
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  }, undefined, { timeout: 10_000 });

  // 2. Wait for the DEV helper to be wired.
  await page.waitForFunction(
    () => Boolean((window as any).__zilventorMultiBodyStepImport),
    undefined,
    { timeout: 30_000 },
  );

  // 3. Ship the real two-bodies.step fixture as base64 into the browser.
  const stepBytes = readFileSync(TWO_BODIES);
  const base64 = stepBytes.toString('base64');

  const result = await page.evaluate(
    async ({ base64, fileName }: { base64: string; fileName: string }) => {
      return (window as any).__zilventorMultiBodyStepImport(fileName, base64);
    },
    { base64, fileName: 'two-bodies.step' },
  );

  // 4. Assert fan-out: 2 components with correct names.
  expect(result.componentCount).toBe(2);
  expect(result.partNames.sort()).toEqual(['two-bodies_1', 'two-bodies_2']);
  expect(result.statusMessage).toContain('2 bodies');

  // 5. Undo in the SAME session (bus history is in-memory; resets on reload).
  //    The command bus holds the ImportStepAsComponentCommand — undo removes both components.
  await page.evaluate(async () => {
    await (window as any).__zilventorStore.getState().bus?.undo();
  });

  const afterUndo = await page.evaluate(async () => {
    const doc = (window as any).__zilventorStore.getState().activeDocument;
    return doc?.kind === 'assembly' ? doc.document.components.length : -1;
  });
  expect(afterUndo).toBe(0);

  // 6. Redo to restore the 2 components so we can test reload-persistence.
  await page.evaluate(async () => {
    await (window as any).__zilventorStore.getState().bus?.redo();
  });

  const afterRedo = await page.evaluate(async () => {
    const doc = (window as any).__zilventorStore.getState().activeDocument;
    return doc?.kind === 'assembly' ? doc.document.components.length : -1;
  });
  expect(afterRedo).toBe(2);

  // 7. Wait for autosave to persist to OPFS, then reload.
  await waitForAutosave(page);

  await page.reload();
  await waitForKernelReady(page);

  // 8. Both components persist after reload (autosave round-trip proof).
  await page.waitForFunction(
    () => {
      const w = window as any;
      const doc = w.__zilventorStore?.getState().activeDocument;
      return doc?.kind === 'assembly' && doc.document.components.length >= 2;
    },
    undefined,
    { timeout: 15_000 },
  );

  const afterReload = await page.evaluate(async () => {
    const asm = (window as any).__zilventorStore.getState().activeAssembly;
    return {
      count: asm?.components.length ?? 0,
      partPaths: (asm?.components ?? []).map((c) => c.partPath).sort(),
    };
  });
  expect(afterReload.count).toBe(2);
  expect(afterReload.partPaths).toEqual(['two-bodies_1.zipt', 'two-bodies_2.zipt']);
});
