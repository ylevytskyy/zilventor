import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Sweep edit-reopen E2E test.
 *
 * Creates a sweep (circle profile + line path), then double-clicks the Sweep
 * node in the BrowserPane to re-open the dialog in edit mode. Asserts:
 *  - the dialog is visible
 *  - the Profile and Path pick buttons reflect the original sketch IDs
 *  - editingSweepId and sweepInitialValues are set in the store
 *
 * Pattern mirrors hole-edit-reopen.spec.ts.
 *
 * BrowserPane renders the node as:
 *   ▸ Sweep {f.id}
 * with onDoubleClick → openSweepForEdit(f.id).
 */
test('double-click Sweep node re-opens dialog with fields populated', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed profile (circle on XY) and path (line on XZ) sketches via kernel API.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: { addFeature(partId: string, feature: unknown): Promise<void> };
          activePart: { id: string } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PROF',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    });
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    });
  });

  // 2. Open Sweep dialog via W shortcut.
  await page.keyboard.press('w');
  const dialog = page.getByRole('dialog', { name: /Sweep/i });
  await expect(dialog).toBeVisible();

  // 3. Seed sweepProfileSketchId / sweepPathSketchId on the store.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      sweepProfileSketchId: 'PROF',
      sweepPathSketchId: 'PATH',
    }));
  });

  // 4. Confirm pick buttons updated reactively.
  await expect(dialog.getByRole('button', { name: /Profile: PROF/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Path: PATH/i })).toBeVisible();

  // 5. Commit via OK.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 6. Wait for the Sweep node to appear in the BrowserPane.
  //    BrowserPane renders: "▸ Sweep {f.id}"
  const sweepNode = page.getByText(/▸ Sweep SW/);
  await expect(sweepNode).toBeVisible({ timeout: 8_000 });

  // 7. Double-click the Sweep node to re-open the dialog in edit mode.
  await sweepNode.first().dblclick();

  // 8. Dialog should reopen with Profile and Path pick buttons prefilled.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Profile: PROF/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Path: PATH/i })).toBeVisible();

  // 9. Verify the store reflects edit mode with the correct sweep id and initial values.
  const editState = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          editingSweepId: string | null;
          sweepInitialValues: { id: string } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    return {
      editingSweepId: s.editingSweepId,
      hasInitialValues: s.sweepInitialValues !== null,
    };
  });
  expect(editState.editingSweepId).toBeTruthy();
  expect(editState.hasInitialValues).toBe(true);

  // 10. Cancel to close cleanly (no duplicate-feature assertion needed for reopen test).
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible();

  // 11. Confirm there is still exactly one sweep in the feature tree (no duplication).
  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; id: string }>;
          } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    const sweeps = part.featureTree.filter((f) => f.kind === 'sweep');
    return { sweepCount: sweeps.length };
  });
  expect(after.sweepCount).toBe(1);
});
