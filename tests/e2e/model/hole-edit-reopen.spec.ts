import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Hole edit-reopen E2E test.
 *
 * Seeds a 20×20×10mm box and a from-sketch hole with diameter=5mm. Double-clicks
 * the Hole node in the BrowserPane to re-open the dialog. Asserts the dialog
 * opens in edit mode with the Diameter field pre-populated to '5'.
 *
 * Then changes the diameter to '7', clicks OK, and asserts the feature tree
 * still has exactly one hole (replaced in place, not duplicated).
 *
 * Pattern mirrors fillet-edit-reopen.spec.ts (T26).
 *
 * BrowserPane renders the node as:
 *   ▸ Hole {f.id}
 * with onDoubleClick → openHoleForEdit(f.id).
 */
test('double-click Hole node re-opens dialog with fields populated', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed a 20×20 rect extruded 10mm — the body to drill into.
  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  // 2. Add circle sketch for hole placement.
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
      id: 'S2',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
      constraints: [],
    });
  });

  // 3. Open Hole dialog via H shortcut.
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: /Hole/i });
  await expect(dialog).toBeVisible();

  // 4. Seed holeSketchId and fill diameter=5.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      holeSketchId: 'S2',
      holePlacementMode: 'fromSketch',
    }));
  });
  await dialog.getByLabel('Diameter').fill('5');

  // 5. Commit via OK.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 6. Wait for the Hole node to appear in the BrowserPane.
  //    BrowserPane renders: "▸ Hole {f.id}"
  const holeNode = page.getByText(/▸ Hole H/);
  await expect(holeNode).toBeVisible({ timeout: 8_000 });

  // 7. Double-click the Hole node to re-open the dialog in edit mode.
  await holeNode.first().dblclick();

  // 8. Dialog should be visible in edit mode with Diameter pre-populated to '5'.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Diameter')).toHaveValue('5');

  // 9. Verify the store reflects edit mode with the correct hole id.
  const editState = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          editingHoleId: string | null;
          holeInitialValues: { id: string } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    return { editingHoleId: s.editingHoleId, hasInitialValues: s.holeInitialValues !== null };
  });
  expect(editState.editingHoleId).toBeTruthy();
  expect(editState.hasInitialValues).toBe(true);

  // 10. Change diameter and commit — verify only one hole in tree (replaced, not duplicated).
  await dialog.getByLabel('Diameter').fill('7');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

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
    const holes = part.featureTree.filter((f) => f.kind === 'hole');
    return { holeCount: holes.length };
  });
  expect(after.holeCount).toBe(1);
});
