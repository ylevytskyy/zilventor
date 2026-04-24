import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Interactive fillet edge pick E2E.
 *
 * Seeds a 10 mm cube, opens the Fillet dialog via F, arms the pick flow
 * via the Add button, then clicks on a projected top edge midpoint. The
 * test asserts:
 *   - the store's `filletEdges` gains exactly one entry
 *   - the entry's edgeId resolves to the expected (top, side) face pair
 *
 * This exercises the full path: camera raycast (via `screenToRay`) →
 * `EdgePickController.pickFromRay` (ray-vs-segment distance with
 * near-to-camera tiebreak) → store.setFilletEdges.
 */
test('interactive fillet edge pick populates store with a top edge', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '10', value: 10, unit: 'mm' },
      { name: 'r_fillet', expression: '1', value: 1, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  // Wait for the initial execute so tessellatedEdgesRef populates.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // Open Fillet dialog via the `f` shortcut and arm pick mode via Add.
  await page.keyboard.press('f');
  const dialog = page.getByRole('dialog', { name: /Fillet/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Add$/ }).click();

  // Project the midpoint of the top edge between the 'top' face and
  // 'side/0' face to screen coords. E1 is the extrude: top face at z=10,
  // bottom at z=0, sides around the square. side/0 corresponds to
  // (y=0) face — see ExtrudeFeature.ts centroid-sorted side ordering.
  // The shared edge lives along x ∈ [0,10], y=0, z=10; pick midpoint
  // (5, 0, 10).
  const screenPt = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorWorldToScreen3d: (x: number, y: number, z: number) => { x: number; y: number };
    };
    return w.__zilventorWorldToScreen3d(5, 0, 10);
  });

  const canvas = page.locator('main#region-viewport canvas');
  await canvas.click({
    position: { x: screenPt.x, y: screenPt.y },
    force: true,
  });

  // Assert the store's filletEdges now has exactly one entry referring to
  // the top face of E1.
  const picked = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          filletEdges: Array<{
            edgeId: {
              faceA: { featureId: string; role: string; instance?: number };
              faceB: { featureId: string; role: string; instance?: number };
            };
          }>;
        };
      };
    };
    return w.__zilventorStore.getState().filletEdges;
  });
  expect(picked).toHaveLength(1);
  const edgeId = picked[0]!.edgeId;
  const roles = [edgeId.faceA.role, edgeId.faceB.role].sort();
  expect(roles).toEqual(['side', 'top']);
  expect(edgeId.faceA.featureId).toBe('E1');
  expect(edgeId.faceB.featureId).toBe('E1');
});
