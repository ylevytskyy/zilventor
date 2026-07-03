/**
 * E2E: Place a component into an assembly via the real command bus,
 * move the source to a non-zero radius (x=50), then apply
 * CreateCircularPatternCommand (z-axis, count=4, 360°) — probe-only.
 *
 * Drives commands directly (not UI buttons) to avoid dialog interaction
 * complexity, matching the assembly e2e convention.
 *
 * OPFS access: uses __zilventorGetOpfs window hook (App.tsx) — returns the
 * full Opfs instance. Avoids the module-alias resolution error that occurs
 * when importing '@zilventor/kernel/src/storage/Opfs' from page.evaluate.
 *
 * Headless viewport renders BLACK — assert via probes only, no screenshots.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const CUBE_STEP = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step',
);

test(
  'Circular Pattern: place at radius=50 → pattern ×4 around z → assert 4 equidistant instances; undo → back to 1',
  async ({ page }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('PAGEERROR:', e.message); });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('BROWSER ERROR:', m.text());
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── 1. Create a new assembly ──────────────────────────────────────────────
    await page.evaluate(async () => {
      const { NewAssemblyCommand } = await import('/src/commands/NewAssemblyCommand.ts');
      NewAssemblyCommand({ name: 'circ-pattern-test' });
    });

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly',
      undefined, { timeout: 10_000 },
    );

    // ── 2. Import cube-10mm.step as a component ───────────────────────────────
    const cubeBytes = readFileSync(CUBE_STEP);
    await page.evaluate(
      async ([bytes]: [number[]]) => {
        const w = window as any;
        const { ImportStepAsComponentCommand } = await import('/src/commands/ImportStepAsComponentCommand.ts');
        const kernel = w.__zilventorStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await w.__zilventorGetOpfs();
        const cmd = new ImportStepAsComponentCommand({
          stepBytes: new Uint8Array(bytes).buffer,
          fileName: 'cube-10mm.step',
          kernel,
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      [Array.from(cubeBytes)] as [number[]],
    );

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length >= 1,
      undefined, { timeout: 30_000 },
    );

    // ── 3. Get the placed component id ────────────────────────────────────────
    const srcCompId = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      return s?.activeAssembly?.components[0]?.id ?? null;
    });
    expect(srcCompId).toBeTruthy();

    // ── 4. Move source to x=50, y=0, z=0 (non-zero radius from z-axis) ───────
    // ImportStepAsComponentCommand places the source at origin (0,0,0).
    // A circular pattern around z through origin with radius=0 is degenerate
    // (all instances overlap at origin). Moving the source to x=50 gives a
    // real circle of radius=50 in the XY plane.
    await page.evaluate(
      async ([srcId]: [string]) => {
        const store = (window as any).__zilventorStore.getState();
        const asm = store.activeAssembly;
        if (!asm) throw new Error('no active assembly');
        const comp = asm.components.find((c: any) => c.id === srcId);
        if (!comp) throw new Error('source component not found');
        // Mutate pose directly via updateComponent (store action)
        store.updateComponent(srcId, {
          position: { x: 50, y: 0, z: 0 },
          pose: {
            translation: { x: 50, y: 0, z: 0 },
            quaternion: [0, 0, 0, 1] as [number, number, number, number],
          },
        });
      },
      [srcCompId] as [string],
    );

    // Verify move applied
    await page.waitForFunction(
      ([id]) => {
        const s = (window as any).__zilventorStore?.getState();
        const c = s?.activeAssembly?.components?.find((c: any) => c.id === id);
        return c && Math.abs((c.pose?.translation?.x ?? c.position?.x ?? 0) - 50) < 1;
      },
      [srcCompId],
      { timeout: 5_000 },
    );

    // ── 5. Apply circular pattern: z-axis, center=origin, count=4, 360° ──────
    await page.evaluate(
      async ([srcId]: [string]) => {
        const { CreateCircularPatternCommand } = await import('/src/commands/CreateCircularPatternCommand.ts');
        const cmd = new CreateCircularPatternCommand({
          sourceInstanceId: srcId,
          axis: 'z',
          center: { x: 0, y: 0, z: 0 },
          count: 4,
          totalAngleDeg: 360,
          rotateInstances: true,
        });
        await (window as any).__zilventorStore.getState().bus.execute(cmd);
      },
      [srcCompId] as [string],
    );

    // ── 6. Assert 4 components total (source + 3 new) ─────────────────────────
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    // ── 7. Assert all 3 new instances are equidistant from z-axis ─────────────
    // Source is at x=50, y=0 → radius=50 from z-axis (hypot(50,0)=50).
    // The 3 new instances (90°, 180°, 270°) should each be at radius≈50.
    // We ignore the source instance itself and check only the new ones.
    const radiusCheck = await page.evaluate(
      ([srcId]: [string]) => {
        const s = (window as any).__zilventorStore?.getState();
        const comps: any[] = s?.activeAssembly?.components ?? [];
        const newInstances = comps.filter((c: any) => c.id !== srcId);
        const radii = newInstances.map((c: any) => {
          const tx = c.pose?.translation?.x ?? c.position?.x ?? 0;
          const ty = c.pose?.translation?.y ?? c.position?.y ?? 0;
          return Math.hypot(tx, ty);
        });
        return { count: comps.length, newCount: newInstances.length, radii };
      },
      [srcCompId] as [string],
    );

    expect(radiusCheck.count).toBe(4);
    expect(radiusCheck.newCount).toBe(3);
    // All 3 new instances must be at radius ≈ 50 (same as source distance from z-axis)
    for (const r of radiusCheck.radii) {
      expect(r).toBeCloseTo(50, 1);
    }

    // ── 8. Undo pattern → assert back to 1 component ─────────────────────────
    await page.evaluate(async () => {
      await (window as any).__zilventorStore.getState().bus.undo();
    });

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 1,
      undefined, { timeout: 10_000 },
    );

    const finalCount = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      return s?.activeAssembly?.components.length ?? -1;
    });
    expect(finalCount).toBe(1);

    expect(pageErrors).toHaveLength(0);
  },
);
