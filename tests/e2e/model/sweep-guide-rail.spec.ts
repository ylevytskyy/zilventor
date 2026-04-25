import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Sweep E2E smoke test — guide rail orientation.
 *
 * Seeds three sketches directly via kernel.addFeature:
 *   - PROF: circle (r=1) on XY plane  — profile (closed wire)
 *   - PATH: line (0,0)→(0,10) on XZ plane — path (open wire, 10mm)
 *   - GUIDE: line (3,0)→(3,10) on XZ plane — guide rail (parallel, offset 3mm)
 *
 * Opens the Sweep dialog via the W keyboard shortcut, switches orientation to
 * "Guide Rail", seeds all three sketch IDs via __zilventorStore.setState
 * (interactive SketchPickController wiring is a follow-up), and clicks OK.
 * Asserts the feature tree contains a sweep and the geometry hash changes.
 *
 * OCCT ContactOnBorder mode deforms the profile to touch the guide rail —
 * the test only confirms the sweep lands in the tree without errors.
 */
test('sweep with guide rail orientation tracks the rail', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Add profile, path, and guide rail sketches directly via kernel.addFeature.
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
      plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    });
    // Path: line along Z axis on XZ plane (open wire — 10mm sweep length)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'PATH',
      plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    });
    // Guide rail: parallel line offset 3mm along X (ContactOnBorder will scale profile to touch it)
    await s.kernel.addFeature(s.activePart!.id, {
      kind: 'sketch',
      id: 'GUIDE',
      plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 3, y1: 0, x2: 3, y2: 10 }],
      constraints: [],
    });
  });

  // 2. Capture geometry hash before sweep (part has three sketch features, no solid yet).
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toBeVisible();
  const hashBefore = await viewport.getAttribute('data-geometry-hash');

  // 3. Open Sweep dialog via W shortcut.
  await page.keyboard.press('w');
  const dialog = page.getByRole('dialog', { name: /Sweep/i });
  await expect(dialog).toBeVisible();

  // 4. Seed all three sketch picks AND orientation on the store AFTER the dialog opens.
  //    The dialog reads these reactively from Zustand; switching orientationKind to
  //    'guideRail' causes it to render the Guide Rail pick button.
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
      sweepGuideRailSketchId: 'GUIDE',
      sweepOrientationKind: 'guideRail',
    }));
  });

  // 5. Verify pick buttons updated reactively (this also ensures React has re-rendered
  //    the new closure before we click OK — no explicit waitForTimeout needed).
  await expect(dialog.getByRole('button', { name: /Profile: PROF/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Path: PATH/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Guide rail: GUIDE/i })).toBeVisible();

  // 6. Wait for the live preview to finish before clicking OK.
  //    Setting state triggers a debounced (150ms) previewFeature call to the OCCT
  //    kernel worker.  The commit also calls the kernel; Comlink serialises all
  //    calls through the worker message queue, so the commit is blocked until the
  //    preview completes.  For guide-rail orientation the OCCT ContactOnBorder
  //    algorithm is slow (~8-15s on this machine), causing a long block.
  //
  //    We detect preview completion by pinging the kernel: a ping response means
  //    the worker is idle (the preview Comlink call has finished).  We issue the
  //    ping after the 150ms debounce window has elapsed, then await its response.
  await page.waitForFunction(
    () => ((window as any).__zilventorSweepPreviewCount ?? 0) >= 1,
    { timeout: 5_000 },
  );
  // Ping the kernel worker; it queues after the preview call and resolves only
  // when the preview finishes — giving us a reliable idle signal.
  await page.evaluate(async () => {
    const k = (window as any).__zilventorStore.getState().kernel;
    await k.ping('idle-check');
  });

  const okButton = dialog.getByRole('button', { name: 'OK' });
  await expect(okButton).toBeEnabled();
  await okButton.click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

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

  // 9. Geometry hash must have changed — a guide-rail-oriented sweep was produced.
  //    The guide-rail OCCT tessellation is slow; give it up to 30s.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 30_000,
      message: 'expected geometry to change after guide-rail sweep',
    })
    .not.toBe(hashBefore);
});
