import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Hole linear-placement E2E smoke test.
 *
 * Seeds a 20×20×10mm box via seedKernelPart (extrude feature id='E1'),
 * opens the Hole dialog via H key, switches to Linear mode, seeds the
 * placement picks (face + 2 ref edges) directly on the store via
 * page.evaluate (interactive 3-D pick is a follow-up — T30), selects a
 * Counterbore profile, selects Distance termination, clicks OK, then
 * asserts the geometry hash changed, confirming a hole was drilled.
 *
 * Face/edge naming produced by executeExtrudeFeature:
 *   - 'top'     (role='top',     instance=0) — highest-Z face
 *   - 'bottom'  (role='bottom',  instance=0) — lowest-Z face
 *   - 'side[0]' (role='side',    instance=0) — first side by atan2 sort
 *   - 'side[1]' (role='side',    instance=1) — second side (perpendicular)
 *
 * canonicalEdgeName({featureId:'E1',role:'side',instance:0},
 *                   {featureId:'E1',role:'top', instance:0})
 *  → faceA = side[0], faceB = top  (because 'E1|side|0' < 'E1|top|0')
 *
 * The dialog's onOk hardcodes offset1=5, offset2=5 (literal) — the input
 * boxes are decorative in the current implementation, so no fill is needed.
 *
 * UI limitations:
 *   - holePlacementFace / holeRefEdges are seeded via page.evaluate (T30
 *     wires interactive pick).
 */
test('linear placement drills CBORE blind hole', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1. Seed a 20×20 rect extruded 10mm with feature id='E1'.
  //    executeExtrudeFeature will name faces: top / bottom / side[0..3].
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

  // 2. Capture geometry hash before drilling.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 3. Open Hole dialog via H shortcut.
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: /Hole/i });
  await expect(dialog).toBeVisible();

  // 4. Switch to Linear placement mode.
  await dialog.getByRole('radio', { name: /linear/i }).check();

  // 5. Seed picks via store.
  //
  //    FaceName for top face of extrude 'E1':
  //      { featureId: 'E1', role: 'top', instance: 0 }
  //
  //    EdgeName between top and side[0]:
  //      canonicalEdgeName sorts by '<featureId>|<role>|<instance>':
  //        'E1|side|0'  vs  'E1|top|0'  → 'E1|side|0' < 'E1|top|0'
  //        → faceA = side[0], faceB = top
  //
  //    EdgeName between top and side[1]:
  //        'E1|side|1'  vs  'E1|top|0'  → 'E1|side|1' < 'E1|top|0'
  //        → faceA = side[1], faceB = top
  //
  //    side[0] and side[1] are adjacent to the top face and perpendicular
  //    to each other (they are neighbouring faces of the rectangular prism
  //    sorted by atan2), satisfying the linear resolver's non-parallel check.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        setState(fn: (s: unknown) => unknown): void;
      };
    };
    w.__zilventorStore.setState((s: any) => ({
      ...s,
      holePlacementMode: 'linear',
      holePlacementFace: { featureId: 'E1', role: 'top', instance: 0 },
      holeRefEdges: [
        // edge between top and side[0]
        {
          faceA: { featureId: 'E1', role: 'side', instance: 0 },
          faceB: { featureId: 'E1', role: 'top',  instance: 0 },
        },
        // edge between top and side[1]
        {
          faceA: { featureId: 'E1', role: 'side', instance: 1 },
          faceB: { featureId: 'E1', role: 'top',  instance: 0 },
        },
      ],
    }));
  });

  // 6. Profile: Counterbore — check radio BEFORE filling CBORE fields (they
  //    are only rendered after the radio is selected).
  await dialog.getByRole('radio', { name: /counterbore/i }).check();
  await dialog.getByLabel('Diameter').fill('4');
  await dialog.getByLabel('CBORE Ø').fill('8');
  await dialog.getByLabel('CBORE depth').fill('2');

  // 7. Termination: Distance + depth 6mm.
  await dialog.getByLabel('Termination').selectOption('distance');
  await dialog.getByLabel('Depth', { exact: true }).fill('6');

  // 8. Commit via OK.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 9. Geometry hash must have changed — a hole was drilled.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry to change after linear-placement hole drilling',
    })
    .not.toBe(hashBefore);
});
