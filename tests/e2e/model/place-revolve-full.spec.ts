import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T16 — first E2E for revolve: place a full 360° revolve.
 *
 * Approach B (pragmatic state-seeding):
 *   1. UI creates the Part (kernel-backed) so commands can write features.
 *   2. We seed the sketch (rectangle profile + vertical axis line) by pushing
 *      the feature through the kernel, then mirroring the updated part into
 *      the store — both sides stay in sync. Drawing primitives via the UI is
 *      covered by sketcher tests; repeating that here would be redundant and
 *      brittle.
 *   3. Model-mode Revolve dialog opens via the `r` shortcut. We click the
 *      Axis "Pick" button, click the viewport on the seeded axis line (found
 *      via __zilventorWorldToScreen), fill the angle, hit OK.
 *   4. Assert that a single revolve feature landed in the feature tree and
 *      the viewport is meshed (non-zero triangle count).
 */
test('place a full 360° revolve', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a part via the UI so the kernel's internal `parts` map has it.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed a sketch with a rectangle profile + a vertical axis line.
  //    Rectangle: (10,0) to (40,20). Axis: from (0,0) to (0,20) — vertical
  //    line left of the rectangle. Revolving the rectangle around this axis
  //    produces a hollow cylinder (annulus).
  await seedKernelPart(page, {
    sketches: [
      {
        id: 'S_seed',
        primitives: [
          { id: 'P_rect', kind: 'rectangle', x: 10, y: 0, w: 30, h: 20 },
          { id: 'P_axis', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 20 },
        ],
      },
    ],
  });

  // Sketch landed in the browser pane (2 primitives: rectangle + axis line).
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
    'data-sketch-primitive-count',
    '2'
  );

  // 3. Open the Revolve dialog via the `r` shortcut in model mode.
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: /Revolve/i });
  await expect(dialog).toBeVisible();

  // Profile section should show the seeded sketch automatically
  // (computeProfileRef picks the last sketch when activeSketchId is null).
  await expect(dialog.getByText(/S_seed/)).toBeVisible();

  // 4. Click the axis "Pick" button, then click near the axis line in the
  //    viewport. Axis midpoint is (0, 10) in world coords.
  await dialog.getByRole('button', { name: /^Pick$/ }).click();

  // __zilventorWorldToScreen returns canvas-relative coords (from the
  // viewport's bounding rect), so we click through the canvas locator
  // with a position option rather than page.mouse.click — the latter
  // would need page-relative coords.
  const axisCanvasPt = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorWorldToScreen: (wx: number, wy: number) => { x: number; y: number };
    };
    return w.__zilventorWorldToScreen(0, 10);
  });

  const viewport = page.locator('main#region-viewport canvas');
  await viewport.click({
    position: { x: axisCanvasPt.x, y: axisCanvasPt.y },
    force: true,
  });

  // Dialog should now show the axis primitive id.
  await expect(dialog.getByText(/P_axis/)).toBeVisible();

  // 5. Fill the angle to 360 and hit OK.
  await dialog.getByLabel('Angle').fill('360');
  await dialog.getByRole('button', { name: /^OK$/ }).click();

  // Dialog closes on commit.
  await expect(dialog).not.toBeVisible();

  // 6. The feature tree should contain exactly one revolve feature.
  const revolveCount = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }> } | null };
      };
    };
    const s = w.__zilventorStore.getState();
    return s.activePart?.featureTree.filter((f) => f.kind === 'revolve').length ?? 0;
  });
  expect(revolveCount).toBe(1);

  // Viewport has real geometry — triangle count is positive.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/
  );
});
