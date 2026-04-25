import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Sweep E2E smoke test — arc path + rectangle profile → curved molding.
 *
 * Seeds two sketches directly via kernel.addFeature:
 *   - PROF: rectangle (4 lines, closed loop) on XY plane — profile
 *   - PATH: 90° arc on XZ plane — path (open wire)
 *
 * Opens the Sweep dialog via the W keyboard shortcut, seeds
 * sweepProfileSketchId / sweepPathSketchId via __zilventorStore.setState,
 * and clicks OK. Asserts the geometry hash changes, confirming a swept
 * body was added.
 */
test('sweep with arc path + rectangle profile produces curved molding', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Add profile (rectangle, closed) and path (arc, open) sketches directly via
  //    kernel.addFeature — arc is not in SeedSketchPrimitive, so we call the kernel
  //    dev hook directly (same pattern as sweep-path.spec.ts).
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
    // Profile: rectangle on XY plane (closed wire — 4 lines forming a closed loop)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PROF',
      plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'L2', kind: 'line', x1: 2, y1: 0, x2: 2, y2: 1 },
        { id: 'L3', kind: 'line', x1: 2, y1: 1, x2: 0, y2: 1 },
        { id: 'L4', kind: 'line', x1: 0, y1: 1, x2: 0, y2: 0 },
      ],
      constraints: [],
    });
    // Path: 90° arc on XZ plane (open wire — center at (0,5), radius 5)
    // startAngle=-π/2 puts start at (0,0), endAngle=0 puts end at (5,5)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: 'XZ',
      primitives: [
        { id: 'A1', kind: 'arc', cx: 0, cy: 5, r: 5, startAngle: -Math.PI / 2, endAngle: 0 },
      ],
      constraints: [],
    });
  });

  // 2. Capture geometry hash before sweep (part has two sketch features, no solid yet).
  const viewport = page.locator('[data-testid="viewport"]');
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

  // 6. Commit via OK — AddSweepFeatureCommand runs kernel.addFeature + execute +
  //    setActivePart, which updates the viewport mesh automatically.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 7. Assert the feature tree contains the sweep.
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

  // 8. Geometry hash must have changed — a curved molding was swept.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry to change after sweep (curved molding should appear)',
    })
    .not.toBe(hashBefore);
});
