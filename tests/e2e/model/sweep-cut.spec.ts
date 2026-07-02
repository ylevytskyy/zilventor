import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

/**
 * Sweep cut E2E smoke test — sweep a circle along a line with operation:'cut'
 * to carve a channel through a pre-existing 20×20×10 box.
 *
 * Seed order:
 *   1. seedKernelPart: 'box_d'=10mm, BOXSKETCH 10×10 rect on XY → extrude BOX (new)
 *   2. page.evaluate: PROF circle cx=5,cy=5,r=1 on XY; PATH line (5,-1)→(5,11) on XZ
 *
 * Geometry mirrors SweepFeature.integration.spec.ts cut test (proven to carve a channel).
 *
 * Opens the Sweep dialog via the W keyboard shortcut, seeds
 * sweepProfileSketchId / sweepPathSketchId / sweepOperation via
 * __zilventorStore.setState, clicks OK, and asserts:
 *   - feature tree contains a 'sweep'
 *   - geometry hash changed (channel was carved)
 *
 * The cut/join radios are enabled when featureTree.length > 0 (App.tsx line 1863),
 * so the extrude ensures they are active before the dialog opens.
 */
test('sweep cut operation carves a channel through a body', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 1a. Seed the box via seedKernelPart (proven pattern — triggers setActivePart
  //     which causes App's useEffect to run kernel.execute and tessellate).
  //     Box: 10×10 rectangle extruded 10mm — matches the kernel integration test
  //     geometry so the sweep-cut coordinates are proven to work (SweepFeature.spec.ts).
  await seedKernelPart(page, {
    parameters: [{ name: 'box_d', expression: '10', value: 10, unit: 'mm' }],
    sketches: [
      {
        id: 'BOXSKETCH',
        plane: 'XY',
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      },
    ],
    extrudes: [
      {
        id: 'BOX',
        sketchRef: 'BOXSKETCH',
        distanceParam: 'box_d',
        direction: 'forward',
        operation: 'new',
      },
    ],
  });

  // 1b. Add sweep profile (circle) + path (line) via direct kernel calls —
  //     circle is not in SeedSketchPrimitive so seedKernelPart can't add it.
  //
  //     Geometry mirrors SweepFeature.integration.spec.ts cut test (lines 77-104):
  //       Profile: circle cx=5,cy=5,r=1 on XY → world centre (5,5,0)
  //       Path: line x1=5,y1=-1 → x1=5,y1=11 on XZ → world (5,0,-1)→(5,0,11)
  //     The swept cylinder passes completely through the 10mm-tall box, cutting a channel.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: {
            addFeature(partId: string, feature: unknown): Promise<void>;
            getPart(partId: string): Promise<unknown>;
          };
          activePart: { id: string } | null;
          setActivePart(p: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    const partId = s.activePart!.id;

    // Sweep profile: circle centred at (5,5) inside the 10×10 box footprint
    await s.kernel.addFeature(partId, {
      kind: 'sketch',
      id: 'PROF',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 }],
      constraints: [],
    });

    // Sweep path: line on XZ from y=-1 to y=11 (world Z: -1→11) — passes through box
    await s.kernel.addFeature(partId, {
      kind: 'sketch',
      id: 'PATH',
      plane: { source: 'workPlane', featureId: 'origin.XZ' },
      primitives: [{ id: 'L1', kind: 'line', x1: 5, y1: -1, x2: 5, y2: 11 }],
      constraints: [],
    });

    const next = await s.kernel.getPart(partId);
    s.setActivePart(next);
  });

  // 2. Wait for the box mesh to appear (confirms the extrude produced a solid).
  const viewport = page.locator('[data-testid="viewport"]');
  await expect(viewport).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 10_000 });
  const hashBefore = await viewport.getAttribute('data-geometry-hash');
  expect(hashBefore).toBeTruthy();

  // 3. Open Sweep dialog via W shortcut.
  await page.keyboard.press('w');
  const dialog = page.getByRole('dialog', { name: /Sweep/i });
  await expect(dialog).toBeVisible();

  // 4. Seed profile + path picks and operation:'cut' on the store.
  //    The dialog reads these reactively — hasRunningBody is true because
  //    featureTree.length > 0 (BOX extrude + sketches present).
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
      sweepOperation: 'cut',
    }));
  });

  // 5. Verify picks and operation reflected in dialog.
  await expect(dialog.getByRole('button', { name: /Profile: PROF/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Path: PATH/i })).toBeVisible();

  // The Cut radio should be checked (seeded above) and enabled (hasRunningBody=true).
  const cutRadio = dialog.getByRole('radio', { name: /^cut$/i });
  await expect(cutRadio).toBeChecked();
  await expect(cutRadio).toBeEnabled();

  // 6. Commit via OK.
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).not.toBeVisible();

  // 7. Assert feature tree contains the sweep.
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

  // 8. Geometry hash must change — a channel was carved through the box.
  await expect
    .poll(async () => viewport.getAttribute('data-geometry-hash'), {
      timeout: 10_000,
      message: 'expected geometry hash to change after sweep cut (channel should be carved)',
    })
    .not.toBe(hashBefore);
});
