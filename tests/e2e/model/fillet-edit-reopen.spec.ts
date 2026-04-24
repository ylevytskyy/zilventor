import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * T26 — re-open a committed fillet for edit.
 *
 * Seeds a cube + a constant-radius fillet parameterized on `r_fillet=1`.
 * Double-clicks the fillet node in the BrowserPane; asserts the dialog
 * opens with (a) the Radius input pre-populated to '1', (b) the edges
 * list containing the stored edge. Changes the radius to '2.5', clicks
 * OK, and asserts the feature tree still contains exactly one fillet
 * with the original id (replaced in place, not duplicated).
 */
test('re-open committed fillet pre-populates dialog and edits in place', async ({ page }) => {
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
    fillets: [
      {
        id: 'F_orig',
        mode: 'constant',
        edges: [
          {
            edgeId: {
              faceA: { featureId: 'E1', role: 'top', instance: 0 },
              faceB: { featureId: 'E1', role: 'side', instance: 0 },
            },
            selectionMode: 'edge',
            radius: { kind: 'param', paramName: 'r_fillet' },
          },
        ],
      },
    ],
  });

  // Wait for mesh to render.
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/);

  // Double-click the Fillet1 node in the browser pane.
  await page.getByText('▸ Fillet1').dblclick();

  // Dialog is open; Radius input holds the seeded expression '1'.
  const dialog = page.getByRole('dialog', { name: /Fillet/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Radius')).toHaveValue('1');

  // Edges list has the one seeded edge.
  const edgesBefore = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { filletEdges: unknown[]; editingFilletId: string | null } };
    };
    const s = w.__zilventorStore.getState();
    return { count: s.filletEdges.length, editingId: s.editingFilletId };
  });
  expect(edgesBefore.count).toBe(1);
  expect(edgesBefore.editingId).toBe('F_orig');

  // Change radius and commit.
  await dialog.getByLabel('Radius').fill('2.5');
  await dialog.getByRole('button', { name: 'OK' }).click();

  // Dialog closes; the feature tree still has exactly one fillet, and its
  // id is the original F_orig (replaced in place).
  await expect(dialog).not.toBeVisible();
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
    const fillets = part.featureTree.filter((f) => f.kind === 'fillet');
    return { count: fillets.length, id: fillets[0]?.id, radius: part.parameters['r_fillet']?.expression };
  });
  expect(after.count).toBe(1);
  expect(after.id).toBe('F_orig');
  expect(after.radius).toBe('2.5');
});
