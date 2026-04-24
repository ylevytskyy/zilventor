import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Shell smoke E2E.
 *
 * Seeds a 10 mm cube, opens the Shell dialog via `s`, toggles the top
 * face, sets thickness to -1 (hollow inward 1 mm), clicks OK, and
 * asserts the feature tree now has a shell + geometry changed.
 */
test('shell hollows a cube and updates the viewport geometry', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await seedKernelPart(page, {
    parameters: [
      { name: 'd1', expression: '20', value: 20, unit: 'mm' },
    ],
    sketches: [
      {
        id: 'S1',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
      },
    ],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }],
  });

  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
  const beforeHash = await viewport.getAttribute('data-geometry-hash');

  // Open Shell dialog via `s` shortcut.
  await page.keyboard.press('s');
  const dialog = page.getByRole('dialog', { name: /Shell/i });
  await expect(dialog).toBeVisible();

  // The face list should be populated from the last execute's faceNames.
  // Check the "E1/top" face checkbox by its data-face-key.
  const topFaceBox = dialog.locator('[data-face-key="E1|top|0"]');
  await expect(topFaceBox).toBeVisible();
  await topFaceBox.check();

  // Thickness defaults to -1 (hollow). Commit.
  await expect(dialog.getByLabel('Thickness')).toHaveValue('-1');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await expect(dialog).not.toBeVisible();

  // Feature tree has a shell; geometry changed.
  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: {
            featureTree: Array<{ kind: string; id: string }>;
            parameters: Record<string, { expression: string }>;
          } | null;
        };
      };
    };
    const part = w.__zilventorStore.getState().activePart!;
    const shells = part.featureTree.filter((f) => f.kind === 'shell');
    return {
      shellCount: shells.length,
      thickness: part.parameters['t_shell']?.expression,
    };
  });
  expect(after.shellCount).toBe(1);
  expect(after.thickness).toBe('-1');

  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 5_000,
      message: 'expected geometry to change after shell',
    })
    .not.toBe(beforeHash);
});
