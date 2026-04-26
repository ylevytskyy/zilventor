import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T44: E2E — broken-ref badge after part edit.
 *
 * Strategy (real roundtrip):
 *  1. Seed cube part, place twice, mate top↔bottom — assert solver converges
 *     with brokenRef=false.
 *  2. Re-pack the cube part with a different feature id (E1 → E1_renamed)
 *     and overwrite parts/cube.zipt in OPFS.
 *  3. Call __zilventorAssemblyInvalidatePart('parts/cube.zipt') to drop the
 *     stale per-part caches (kernel partId, ref cache, geometry cache) and
 *     bump solverDirty. The next solver run re-loads the part bytes and
 *     re-resolves the constraint refs against the new shape.
 *  4. The mate constraint still references {featureId:'E1', role:'top'}
 *     and {featureId:'E1', role:'bottom'} — neither exists in the renamed
 *     part — so the solver flags brokenRef=true on the constraint.
 */
test('T44 — broken-ref badge after part-file edit roundtrip', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Open assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place cube twice.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cube$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
    await page.waitForFunction(
      (expected) => {
        const w = window as any;
        return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === expected;
      },
      i + 1,
    );
  }

  const componentIds = await page.evaluate((): string[] => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id);
  });
  const [c1, c2] = componentIds as [string, string];

  // Add a valid mate constraint (top of c1 to bottom of c2).
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  await page.getByRole('button', { name: /^pick…$/i }).first().click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('A', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'top', instance: 0 },
    });
  }, [c1]);

  await page.getByRole('button', { name: /^pick…$/i }).nth(1).click();
  await page.evaluate(([id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentId: id,
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, [c2]);

  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for initial solve — should converge with brokenRef=false.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 10_000 });

  const initialEntry = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values())[0] ?? null;
  });
  expect(initialEntry).not.toBeNull();
  expect(initialEntry!.brokenRef).toBe(false);

  // Real part-edit roundtrip:
  // 1. Re-pack the cube part with the extrude renamed to a different id.
  // 2. Overwrite parts/cube.zipt in OPFS.
  // 3. Invalidate the assembly's per-part caches (kernel partId, ref cache,
  //    geometry cache) and bump solverDirty so the next solve re-loads.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorPackProject: (input: {
        manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array;
      }) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
      __zilventorAssemblyInvalidatePart: (partPath: string) => Promise<void>;
    };
    const renamedDoc = {
      id: 'P_cube',
      name: 'cube',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' },
      },
      featureTree: [
        { kind: 'sketch', id: 'S0', plane: 'XY',
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 50, h: 50 }],
          constraints: [] },
        // The constraint refers to E1; this part now exposes E1_renamed.
        { kind: 'extrude', id: 'E1_renamed', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
      ],
    };
    const manifest = {
      formatVersion: 7,
      kind: 'part',
      createdAt: new Date().toISOString(),
      appVersion: '0.0.0',
      document: renamedDoc,
    };
    const png = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82,
    ]);
    const archive = await w.__zilventorPackProject({ manifest, blobs: {}, thumbnail: png });
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write('parts/cube.zipt', archive);
    await w.__zilventorAssemblyInvalidatePart('parts/cube.zipt');
  });

  // Wait for re-solve — refs to E1/top, E1/bottom no longer resolve.
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if ((diag?.perConstraint?.size ?? 0) === 0) return false;
    const first = Array.from((diag.perConstraint as Map<string, any>).values())[0];
    return first?.brokenRef === true;
  }, undefined, { timeout: 10_000 });

  const brokenEntry = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values())[0] ?? null;
  });
  expect(brokenEntry).not.toBeNull();
  expect(brokenEntry!.brokenRef).toBe(true);
});
