import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T31 — non-panel parts are excluded from the cut list.
 *
 * Seeds:
 *   - 2 panel parts (side, top) — appear as cut-list rows.
 *   - 2 distinct non-panel (extrude-based) parts (leg, rail) — excluded.
 *
 * Places:
 *   - 1× side-panel
 *   - 1× top-panel
 *   - 2× leg     (same partPath → 1 distinct part, 2 components)
 *   - 1× rail    (distinct partPath → 1 distinct part, 1 component)
 *
 * Expects exclusion footer:
 *   "Excluded from cut list: 3 components (2 distinct parts)"
 */
test('T31 — non-panel parts excluded: 3 components, 2 distinct parts', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add the panel material to the assembly registry.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { addMaterial(m: unknown): void };
      };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed two panel parts to OPFS.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t31-side.zipt',
    partName: 't31-side',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t31-top.zipt',
    partName: 't31-top',
    length: 800, width: 400, thickness: 18,
    materialId: 'm-birch',
    grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Seed two non-panel parts (extrude-based) to OPFS.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorPackProject: (input: {
        manifest: unknown;
        blobs: Record<string, Uint8Array>;
        thumbnail?: Uint8Array;
      }) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
    };

    function makeExtrudePart(id: string, name: string, size: number): unknown {
      return {
        formatVersion: 11,
        kind: 'part',
        createdAt: new Date().toISOString(),
        appVersion: '0.0.0',
        document: {
          id,
          name,
          units: 'mm',
          parameters: { d0: { name: 'd0', expression: String(size), value: size, unit: 'mm' } },
          featureTree: [
            {
              kind: 'sketch', id: 'S0', plane: 'XY',
              primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: size, h: size }],
              constraints: [],
            },
            { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
          ],
          properties: {},
          materials: [],
        },
      };
    }

    const opfs = await w.__zilventorGetOpfs();

    const legArchive = await w.__zilventorPackProject({ manifest: makeExtrudePart('leg-id', 't31-leg', 40), blobs: {} });
    await opfs.write('parts/t31-leg.zipt', legArchive);

    const railArchive = await w.__zilventorPackProject({ manifest: makeExtrudePart('rail-id', 't31-rail', 30), blobs: {} });
    await opfs.write('parts/t31-rail.zipt', railArchive);
  });

  // 5. Place components: 1× side, 1× top, 2× leg, 1× rail.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t31-side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t31-top.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C2', partPath: 'parts/t31-leg.zipt', position: { x: 0, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C3', partPath: 'parts/t31-leg.zipt', position: { x: 100, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C4', partPath: 'parts/t31-rail.zipt', position: { x: 200, y: 700, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 5;
  });

  // 6. Populate panel spec cache from OPFS (non-panel parts get null → excluded).
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 7. Open the Cut List tab.
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 8. Assert panel rows: 2 rows (side + top), each QTY 1.
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });

  // 9. Assert exclusion footer: 3 components (2× leg + 1× rail), 2 distinct parts (leg + rail).
  await expect(page.getByText('Excluded from cut list: 3 components')).toBeVisible();
  await expect(page.getByText('(2 distinct parts)')).toBeVisible();
});
