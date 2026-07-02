/**
 * E2E: Part-mode File→Open on a multi-body STEP imports the WHOLE compound
 * as a single part with status 'Imported' (NOT 'Imported first body of N').
 *
 * Phase 1 discriminator: the `statusMessage` assertion.
 * Old behaviour (pre-Phase-1) set status = 'Imported first body of 2';
 * new behaviour sets status = 'Imported' — proving the whole compound is kept.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test('part-mode multi-body STEP opens as one whole-compound part (status Imported)', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('BROWSER ERROR:', m.text());
  });
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.log('PAGEERROR:', e.message);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // 0. Confirm starting state: no active document (clean fresh session = part-mode).
  const initialDoc = await page.evaluate(() => {
    return (window as any).__zilventorStore?.getState().activeDocument ?? null;
  });
  expect(initialDoc).toBeNull();

  // 1. Inject the two-bodies.step fixture into the page and override
  //    window.showOpenFilePicker so the real File→Open button picks it up.
  const stepBytes = readFileSync(TWO_BODIES);
  await page.evaluate(
    async ([bytes]: [number[]]) => {
      const fakeFile = {
        name: 'two-bodies.step',
        arrayBuffer: async () => new Uint8Array(bytes).buffer,
      };
      const fakeHandle = { getFile: async () => fakeFile };
      (window as any).showOpenFilePicker = async () => [fakeHandle];
    },
    [Array.from(stepBytes)] as [number[]],
  );

  // 2. Drive the real File → Open… button (the same code path Phase 1 changed).
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /open/i }).click();

  // 3. Wait for the active document to become a part.
  await page.waitForFunction(
    () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
    undefined,
    { timeout: 60_000 },
  );

  // 4. Read the final store state for assertions.
  const state = await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    const part = s.activePart;
    const importedFeature = part?.featureTree?.find((f: any) => f.kind === 'imported') as
      | { kind: string; bodyRef: string }
      | undefined;
    return {
      documentKind: s.activeDocument?.kind ?? null,
      partName: part?.name ?? null,
      statusMessage: s.statusMessage,
      importedFeatureBodyRef: importedFeature?.bodyRef ?? null,
      importedFeatureCount: part?.featureTree?.filter((f: any) => f.kind === 'imported').length ?? 0,
    };
  });

  // 5. Assertions — Phase-1 discriminators.

  // 5a. Must be a part, not an assembly (part-mode open stays in part mode).
  expect(state.documentKind).toBe('part');

  // 5b. Name is the bare file stem — no _1 suffix (whole-compound, not fan-out).
  expect(state.partName).toBe('two-bodies');

  // 5c. THE KEY Phase-1 proof: 'Imported', NOT 'Imported first body of 2'.
  //     Under the OLD code this would have been 'Imported first body of 2'.
  expect(state.statusMessage).toBe('Imported');

  // 5d. Exactly one 'imported' feature whose bodyRef starts with 'imp-'.
  expect(state.importedFeatureCount).toBe(1);
  expect(state.importedFeatureBodyRef).toMatch(/^imp-/);

  // 6. No uncaught page errors.
  expect(pageErrors).toHaveLength(0);
});
