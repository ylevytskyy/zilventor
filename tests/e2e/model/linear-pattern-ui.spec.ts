import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * LinearPatternDialog E2E.
 *
 * Seeds a body + a join extrude (so there's a patternable source),
 * opens the dialog via L shortcut, picks the source from the dropdown,
 * sets spacing and count, clicks OK, and asserts the feature tree has
 * the pattern and the geometry hash changes.
 */
test('LinearPatternDialog L shortcut commits a pattern feature', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '50', value: 50, unit: 'mm' },
      { name: 'd2', expression: '10', value: 10, unit: 'mm' },
    ],
    sketches: [
      { id: 'S1', primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 50, h: 50 }] },
      { id: 'S2', primitives: [{ id: 'R2', kind: 'rectangle', x: 100, y: 0, w: 10, h: 10 }] },
    ],
    extrudes: [
      { id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' },
      { id: 'E2', sketchRef: 'S2', distanceParam: 'd2', operation: 'join' },
    ],
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const beforeHash = await viewport.getAttribute('data-geometry-hash');

  // Open dialog via L shortcut.
  await page.keyboard.press('l');
  const dialog = page.getByRole('dialog', { name: /Linear Pattern/i });
  await expect(dialog).toBeVisible();

  // Source dropdown has both extrudes. Pick E2 (the disjoint source).
  await dialog.getByLabel('Source').selectOption('E2');

  // Default axis X is fine. Set spacing + count.
  await dialog.getByLabel('Spacing').fill('40');
  await dialog.getByLabel('Count').fill('3');

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activePart: { featureTree: Array<{ kind: string }>; parameters: Record<string, { expression: string }> } | null };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    const patterns = part.featureTree.filter((f) => f.kind === 'pattern-linear');
    return {
      count: patterns.length,
      pitch: part.parameters['pattern_pitch']?.expression,
    };
  });
  expect(after.count).toBe(1);
  expect(after.pitch).toBe('40');

  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 5_000,
      message: 'expected geometry hash to change after pattern commit',
    })
    .not.toBe(beforeHash);
});
