import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Mirror smoke E2E. Seeds a body + a disjoint join extrude (source on
 * +X side), opens the Mirror dialog via M, picks the source from the
 * dropdown, leaves plane at YZ (mirrors across x=0 — source at x=100
 * becomes copy at x=-110), clicks OK. Asserts the feature tree has the
 * mirror and the geometry hash changes.
 */
test('MirrorDialog M shortcut commits a mirror feature', async ({ page }) => {
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

  await page.keyboard.press('m');
  const dialog = page.getByRole('dialog', { name: /Mirror/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Source feature').selectOption('E2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activePart: { featureTree: Array<{ kind: string }> } | null } };
    };
    const part = w.__zilventorStore.getState().activePart!;
    return { mirrors: part.featureTree.filter((f) => f.kind === 'mirror').length };
  });
  expect(after.mirrors).toBe(1);

  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 5_000,
      message: 'expected geometry to change after mirror commit',
    })
    .not.toBe(beforeHash);
});
