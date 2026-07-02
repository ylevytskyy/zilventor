import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Sweep E2E smoke test — line path + circle profile → cylinder.
 *
 * Seeds two sketches directly via kernel.addFeature (circle primitives
 * are not in SeedSketchPrimitive, so we call the kernel API directly,
 * matching the hole-from-sketch.spec.ts pattern):
 *   - PROF: circle (r=1) on XY plane  — profile (must be closed)
 *   - PATH: line (0,0)→(0,10) on XZ plane — path (open wire, 10mm sweep)
 *
 * Opens the Sweep dialog via the W keyboard shortcut, seeds
 * sweepProfileSketchId / sweepPathSketchId via __zilventorStore.setState
 * (interactive SketchPickController wiring is a follow-up), and clicks OK.
 * Asserts the geometry hash changes, confirming a swept body was added.
 *
 * UI limitations:
 *   - sweepProfileSketchId / sweepPathSketchId are seeded via page.evaluate
 *     (pick buttons are stubs pending SketchPickController wiring).
 */
test('sweep with line path + circle profile produces a cylinder', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Add profile (circle, closed) and path (line, open) sketches directly via
  //    kernel.addFeature — circle is not in SeedSketchPrimitive, so we skip
  //    seedKernelPart and call the kernel dev hook directly (same as hole-from-sketch).
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
    // Profile: circle on XY plane (closed wire — required by SweepOps)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PROF',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    });
    // Path: line along Z axis on XZ plane (open wire — 10mm sweep length)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    });
  });

  // 2. Capture geometry hash before sweep (part has two sketch features, no solid yet).
  const viewport = page.locator('[data-testid="viewport"]');
  // Wait for the viewport to be present (may not have triangles yet — that's OK).
  await expect(viewport).toBeVisible();
  const hashBefore = await viewport.getAttribute('data-geometry-hash');

  // 3. Open Sweep dialog via W shortcut.
  await page.keyboard.press('w');
  const dialog = page.getByRole('dialog', { name: /Sweep/i });
  await expect(dialog).toBeVisible();

  // 4. Seed the sketch picks on the store AFTER the dialog opens — the dialog
  //    reads sweepProfileSketchId / sweepPathSketchId reactively from the store.
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

  // 5. Verify the dialog shows the selected sketches (pick buttons update reactively).
  await expect(dialog.getByRole('button', { name: /Profile: PROF/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Path: PATH/i })).toBeVisible();

  // 6. Operation is already 'new' by default (no running body exists).
  //    Orientation is already 'path' by default.

  // 7. Commit via OK — AddSweepFeatureCommand runs kernel.addFeature + execute +
  //    setActivePart, which updates the viewport mesh automatically.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 8. Assert the feature tree contains the sweep.
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
    const sweeps = part.featureTree.filter((f) => f.kind === 'sweep');
    return { sweepCount: sweeps.length };
  });
  expect(afterState.sweepCount).toBeGreaterThanOrEqual(1);

  // 9. Geometry hash must have changed — a cylinder was swept.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry to change after sweep (cylinder should appear)',
    })
    .not.toBe(hashBefore);
});
