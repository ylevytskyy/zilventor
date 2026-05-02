import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T34 — panel parametric cascade.
 *
 * Seeds a part with parameters `panelL = 600`, `panelW = 400`, then injects a
 * `PanelFeature` whose length / width are param-references and one banded
 * edge so the overlay subsystem has something to draw. Edits the parameters
 * via the F7 Parameters panel from 600 → 800, 400 → 500, and asserts the
 * SceneManager edge-band overlay's rebuild reflects the new dimensions.
 *
 * Reads the SceneManager via the dev hook chain App.tsx exposes:
 *   __zilventorViewportRef → getSceneManager() → edgeBandOverlayList()
 * (we read the overlays' geometry attribute "position" min/max range, which
 * matches the panel's L/W exactly per SceneManager.rebuildEdgeBandOverlays).
 *
 * Pattern mirrors `tests/e2e/model/hole-parametric-cascade.spec.ts`.
 */
test('T34 — editing panelL/panelW cascades to edge-band overlay rebuild', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Part.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Seed parameters + a panel that references them.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          kernel: { setParameter(partId: string, p: unknown): Promise<void> };
          activePart: { id: string; featureTree: unknown[] } | null;
          setActivePart(p: unknown): void;
          addMaterial(m: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart) throw new Error('no active part');

    // Drive the kernel + sync via setParameter so the part doc carries the
    // parameters when we mirror it.
    await s.kernel.setParameter(s.activePart.id, {
      name: 'panelL', expression: '600', value: 600, unit: 'mm',
    });
    await s.kernel.setParameter(s.activePart.id, {
      name: 'panelW', expression: '400', value: 400, unit: 'mm',
    });

    // Re-read the part state to pick up the new parameters, then inject the
    // panel feature and material registry on top.
    const stateAfter = w.__zilventorStore.getState().activePart!;
    s.addMaterial({
      id: 'mat-band', name: 'Band', defaultThickness: 1, color: '#ff0000',
    });
    const stateWithMat = w.__zilventorStore.getState().activePart!;
    const panel = {
      kind: 'panel',
      id: 'pf-cascade',
      length: { kind: 'param', paramName: 'panelL' },
      width: { kind: 'param', paramName: 'panelW' },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'mat-band',
      grain: 'length',
      edgeBands: {
        front: { materialId: 'mat-band' },
        back: null, left: null, right: null,
      },
    };
    s.setActivePart({
      ...stateWithMat,
      featureTree: [...stateAfter.featureTree, panel],
    });
  });

  // 3. Mirror parameters into the ParameterRegistry so F7 lists them.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorParameterRegistry: {
        setParameter(p: { name: string; expression: string; unit: string }): unknown;
      };
    };
    w.__zilventorParameterRegistry.setParameter({ name: 'panelL', expression: '600', unit: 'mm' });
    w.__zilventorParameterRegistry.setParameter({ name: 'panelW', expression: '400', unit: 'mm' });
  });

  // 4. Read overlay geometry: a single LineSegments for the front band, whose
  //    BufferGeometry's position attribute spans X = ±panelL/2 at Y = +panelW/2.
  const readOverlay = async () => {
    return await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorViewportRef?: unknown;
      };
      // App.tsx doesn't expose viewportRef by name. Walk through the store's
      // viewport (set via setViewport) to reach the SceneManager.
      const store = (window as unknown as { __zilventorStore: { getState(): { viewport: unknown } } }).__zilventorStore.getState();
      const vp = store.viewport as { getSceneManager?(): unknown } | null;
      const sm = vp?.getSceneManager?.() as
        | { edgeBandOverlayList(): ReadonlyArray<{ geometry: { attributes: { position: { array: ArrayLike<number> } } } }>; }
        | null;
      const list = sm?.edgeBandOverlayList?.() ?? [];
      if (list.length === 0) return null;
      const arr = list[0]!.geometry.attributes.position.array;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i] as number;
        const y = arr[i + 1] as number;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { count: list.length, minX, maxX, minY, maxY };
    });
  };

  // Wait for the overlay to render based on initial 600×400.
  await expect.poll(readOverlay, { timeout: 10_000 }).not.toBeNull();
  const before = await readOverlay();
  expect(before).not.toBeNull();
  expect(before!.count).toBe(1);
  // Front band spans X = ±L/2 at Y = +W/2.
  expect(before!.maxX - before!.minX).toBeCloseTo(600, 1);
  expect(before!.minY).toBeCloseTo(200, 1);
  expect(before!.maxY).toBeCloseTo(200, 1);

  // 5. Edit panelL via the F7 Parameters panel from 600 → 800.
  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  await page.locator('[data-testid="param-expression-panelL"]').dblclick();
  await page.locator('[data-testid="param-row-panelL"] input').fill('800');
  await page.locator('[data-testid="param-row-panelL"] input').press('Enter');
  await expect(page.locator('[data-testid="param-value-panelL"]')).toHaveText('800');

  // 6. Edit panelW from 400 → 500.
  await page.locator('[data-testid="param-expression-panelW"]').dblclick();
  await page.locator('[data-testid="param-row-panelW"] input').fill('500');
  await page.locator('[data-testid="param-row-panelW"] input').press('Enter');
  await expect(page.locator('[data-testid="param-value-panelW"]')).toHaveText('500');

  // 7. The overlay must rebuild at the new dimensions.
  await expect
    .poll(async () => {
      const o = await readOverlay();
      if (!o) return null;
      return Math.round(o.maxX - o.minX);
    }, { timeout: 10_000 })
    .toBe(800);

  const after = await readOverlay();
  expect(after).not.toBeNull();
  expect(after!.maxX - after!.minX).toBeCloseTo(800, 1);
  expect(after!.minY).toBeCloseTo(250, 1);
});
