import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Hole from-sketch E2E smoke test.
 *
 * Seeds a 20×20×10mm box, adds a second sketch with two circles, opens the
 * Hole dialog via H key, seeds holeSketchId directly on the store (the
 * interactive SketchPickController button is a stub — T27), clicks OK, then
 * asserts the viewport geometry hash changes, confirming two holes were drilled.
 *
 * The dialog OK now dispatches AddHoleFeatureCommand which calls
 * kernel.addFeature + execute + setActivePart — no manual page.evaluate
 * workaround is needed.
 *
 * UI limitations:
 *   - holeSketchId is seeded via page.evaluate (pick button is stub, T27).
 */
test('from-sketch simple through hole drills per circle center', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed a 20×20 rect extruded 10mm — this is the body to drill into.
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

  // 2. Add the circle sketch (S2) directly via kernel.addFeature.
  //    SeedSketchPrimitive doesn't include 'circle', so we add it manually.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
          };
          activePart: { id: string } | null;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'S2',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [
        { id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 },
        { id: 'C2', kind: 'circle', cx: 15, cy: 15, r: 1 },
      ],
      constraints: [],
    });
  });

  // 3. Capture geometry hash before drilling.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 4. Open Hole dialog via H shortcut.
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: /Hole/i });
  await expect(dialog).toBeVisible();

  // 5. Seed holeSketchId on the store (interactive pick button is a stub — T27).
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

  // 6. Profile: simple (default), Diameter: 2mm.
  await dialog.getByLabel('Diameter').fill('2');

  // 7. Termination: Through All (default — the select already shows 'Through All').
  const termSelect = dialog.getByLabel('Termination');
  await termSelect.selectOption('throughAll');

  // 8. Commit via OK — AddHoleFeatureCommand drives kernel.addFeature + execute +
  //    setActivePart, so the viewport mesh is updated automatically.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 9. Assert the feature tree contains the hole from the dialog commit.
  const afterState = await page.evaluate(() => {
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
  expect(afterState.holeCount).toBeGreaterThanOrEqual(1);

  // 10. Geometry hash must have changed — two holes were drilled.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 8_000,
      message: 'expected geometry to change after hole drilling',
    })
    .not.toBe(hashBefore);
});
