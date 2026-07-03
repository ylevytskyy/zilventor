/**
 * E2E: Place a component into an assembly via the real command bus,
 * then apply CreateComponentPatternCommand (×4 along X) and
 * MirrorComponentCommand (YZ plane) — both through the bus.
 *
 * Drives commands directly (not the UI buttons) to avoid dialog interaction
 * complexity, matching the assembly e2e convention.
 *
 * OPFS access: uses __zilventorGetOpfs window hook (App.tsx) — returns the full
 * Opfs instance (read/write/delete/listAll/exists). This avoids the
 * "Failed to resolve module specifier '@zilventor/kernel/src/storage/Opfs'"
 * error that occurs when importing the alias from page.evaluate (browser ESM
 * can't resolve workspace aliases; only Vite-transformed code can).
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
  'Component Pattern + Mirror: place → pattern ×4 → assert 4 instances; mirror → assert reflected part path; undo both',
  async ({ page }) => {
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
      // NewAssemblyCommand is a plain function (not a class) — call directly, returns void
      NewAssemblyCommand({ name: 'untitled-assembly' });
    });

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly',
      undefined, { timeout: 10_000 },
    );

    // ── 2. Import cube-10mm.step as a component ───────────────────────────────
    // Uses __zilventorGetOpfs (App.tsx hook) to avoid module-alias resolution errors
    // from page.evaluate when importing '@zilventor/kernel/src/storage/Opfs' directly.
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

    // ── 3. Get the placed component id ───────────────────────────────────────
    const srcCompId = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      return s?.activeAssembly?.components[0]?.id ?? null;
    });
    expect(srcCompId).toBeTruthy();

    // ── 4. Rectangular Pattern: count=4, spacing=15mm along X ─────────────────
    // Source component at origin (0,0,0); pattern adds 3 new at x=15,30,45
    await page.evaluate(
      async ([srcId]: [string]) => {
        const { CreateComponentPatternCommand } = await import('/src/commands/CreateComponentPatternCommand.ts');
        const cmd = new CreateComponentPatternCommand({
          sourceInstanceId: srcId,
          dir1: 'x', count1: 4, spacing1: 15,
        });
        await (window as any).__zilventorStore.getState().bus.execute(cmd);
      },
      [srcCompId] as [string],
    );

    // Assert 4 components total (source + 3 new from pattern)
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    const patternState = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const comps = s?.activeAssembly?.components ?? [];
      return {
        count: comps.length,
        xPositions: (comps as any[])
          .map((c: any) => (c.pose?.translation.x ?? c.position.x))
          .sort((a: number, b: number) => a - b),
      };
    });
    expect(patternState.count).toBe(4);
    // Positions along X: 0, 15, 30, 45 (source placed at origin by ImportStepAsComponentCommand)
    expect(patternState.xPositions[0]).toBeCloseTo(0, 1);
    expect(patternState.xPositions[1]).toBeCloseTo(15, 1);
    expect(patternState.xPositions[2]).toBeCloseTo(30, 1);
    expect(patternState.xPositions[3]).toBeCloseTo(45, 1);

    // ── 5. Screenshot the component array ────────────────────────────────────
    await page.screenshot({ path: '/tmp/pattern-shelf-array.png' });

    // ── 6. Mirror the x=45 patterned component across YZ plane ───────────────
    // Mirroring a non-origin instance proves the sign-flip t'=M·t end-to-end:
    // source at x=45, YZ plane (M=diag(-1,1,1)) → reflected x = -45.
    // This is stronger than mirroring the origin component (x=0→0 is trivially 0).

    // Resolve the instance id for the component closest to x=45
    const x45CompId = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const comps: any[] = s?.activeAssembly?.components ?? [];
      // Find the component with x translation closest to 45
      let best: any = null;
      let bestDist = Infinity;
      for (const c of comps) {
        const cx = c.pose?.translation.x ?? c.position?.x ?? 0;
        const dist = Math.abs(cx - 45);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      return best?.id ?? null;
    });
    expect(x45CompId).toBeTruthy();

    await page.evaluate(
      async ([instId]: [string]) => {
        const w = window as any;
        const { MirrorComponentCommand } = await import('/src/commands/MirrorComponentCommand.ts');
        const kernel = w.__zilventorStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await w.__zilventorGetOpfs();
        const asm = w.__zilventorStore.getState().activeAssembly;
        const instComp = (asm?.components as any[])?.find((c: any) => c.id === instId);
        if (!instComp) throw new Error('x=45 component not found');
        // Load source part bytes from OPFS → get kernel part UUID
        const srcBytes = await opfs.read(instComp.partPath);
        const srcKernelId = await kernel.loadFromBytes(srcBytes);
        const cmd = new MirrorComponentCommand({
          sourceInstanceId: instId,
          sourcePartKernelId: srcKernelId,
          plane: 'yz',
          kernel,
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      [x45CompId] as [string],
    );

    // Assert 5 components total (4 from pattern + 1 mirrored)
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 5,
      undefined, { timeout: 30_000 },
    );

    const mirrorState = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const comps: any[] = s?.activeAssembly?.components ?? [];
      // The mirrored component has "_mirror" in its partPath
      const mirrored = comps.find((c: any) => c.partPath?.includes('_mirror'));
      return {
        count: comps.length,
        mirroredX: mirrored?.pose?.translation.x ?? null,
        mirroredPartPath: mirrored?.partPath ?? null,
      };
    });
    expect(mirrorState.count).toBe(5);
    // Mirrored part path must contain "_mirror"
    expect(mirrorState.mirroredPartPath).toMatch(/_mirror/);
    // Source is at x=45; YZ mirror (M=diag(-1,1,1)): t'=M·t → x'=−45
    // This proves the sign-flip through the full kernel+pose pipeline.
    expect(mirrorState.mirroredX).toBeCloseTo(-45, 1);

    // ── 7. Screenshot the final mirrored assembly ─────────────────────────────
    await page.screenshot({ path: '/tmp/task9-pattern-mirror-final.png' });

    // ── 8. Undo mirror → back to 4 ───────────────────────────────────────────
    await page.evaluate(async () => {
      await (window as any).__zilventorStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    // ── 9. Undo pattern → back to 1 ──────────────────────────────────────────
    await page.evaluate(async () => {
      await (window as any).__zilventorStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 1,
      undefined, { timeout: 10_000 },
    );

    expect(pageErrors).toHaveLength(0);
  },
);
