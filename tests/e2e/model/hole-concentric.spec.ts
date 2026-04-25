import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * Hole concentric-placement E2E smoke test.
 *
 * Seeds a cylindrical body by extruding a circle sketch (direct kernel.addFeature
 * calls, since seedKernelPart's SeedSketchPrimitive type doesn't include 'circle').
 * The extrude adapter assigns face names:
 *   - { featureId: 'EX1', role: 'top',    instance: 0 }  — highest-Z flat disk
 *   - { featureId: 'EX1', role: 'bottom', instance: 0 }  — lowest-Z flat disk
 *   - { featureId: 'EX1', role: 'side',   instance: 0 }  — outer cylindrical face
 *
 * The circular top edge sits between 'top' and 'side[0]':
 *   canonicalEdgeName sorts by '<featureId>|<role>|<instance>':
 *     'EX1|side|0' vs 'EX1|top|0' → 'EX1|side|0' < 'EX1|top|0'
 *     → faceA = side[0], faceB = top
 *
 * Opens the Hole dialog via H key, switches to Concentric mode, seeds the
 * placement picks on the store, selects Countersink profile, throughAll
 * termination, clicks OK, then asserts the geometry hash changed.
 *
 * UI limitations:
 *   - holePlacementFace / holeCircularEdge are seeded via page.evaluate
 *     (interactive 3-D pick is a follow-up).
 */
test('concentric placement drills CSK hole on extruded cylinder', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed a cylinder via direct kernel.addFeature calls:
  //    - sketch S1 with a circle of radius 7, centered at origin
  //    - extrude EX1 of S1 by 10mm (distance parameter 'd1')
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            setParameter(partId: string, p: unknown): Promise<void>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    const partId = s.activePart!.id;

    await s.kernel.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });

    await s.kernel.addFeature(partId, {
      kind: 'sketch',
      id: 'S1',
      plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 7 }],
      constraints: [],
    });

    await s.kernel.addFeature(partId, {
      kind: 'extrude',
      id: 'EX1',
      sketchRef: 'S1',
      distanceParam: 'd1',
      direction: 'forward',
      operation: 'new',
    });

    const next = await s.kernel.getPart(partId);
    s.setActivePart(next);
  });

  // 2. Capture geometry hash before drilling.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 3. Open Hole dialog via H shortcut.
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: /Hole/i });
  await expect(dialog).toBeVisible();

  // 4. Switch to Concentric placement mode.
  await dialog.getByRole('radio', { name: /concentric/i }).check();

  // 5. Seed picks via store.
  //
  //    FaceName for top face of extrude 'EX1':
  //      { featureId: 'EX1', role: 'top', instance: 0 }
  //
  //    EdgeName between top and side[0]:
  //      canonicalEdgeName sorts by '<featureId>|<role>|<instance>':
  //        'EX1|side|0'  vs  'EX1|top|0'  → 'EX1|side|0' < 'EX1|top|0'
  //        → faceA = side[0], faceB = top
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      holePlacementMode: 'concentric',
      holePlacementFace: { featureId: 'EX1', role: 'top', instance: 0 },
      holeCircularEdge: {
        faceA: { featureId: 'EX1', role: 'side', instance: 0 },
        faceB: { featureId: 'EX1', role: 'top',  instance: 0 },
      },
    }));
  });

  // 6. Profile: Countersink with Ø=2mm, CSK Ø=4mm.
  await dialog.getByRole('radio', { name: /countersink/i }).check();
  await dialog.getByLabel('Diameter').fill('2');
  await dialog.getByLabel('CSK Ø').fill('4');

  // 7. Termination: Through All (default).
  await dialog.getByLabel('Termination').selectOption('throughAll');

  // 8. Commit via OK — AddHoleFeatureCommand drives kernel pipeline.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 9. Assert feature tree contains the hole.
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

  // 10. Geometry hash must have changed — a concentric CSK hole was drilled.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry to change after concentric-placement hole drilling',
    })
    .not.toBe(hashBefore);
});
