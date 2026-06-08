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
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { ImportStepAsComponentCommand } = await import('/src/commands/ImportStepAsComponentCommand.ts');
        const kernel = useAppStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await w.__zilventorGetOpfs();
        const cmd = new ImportStepAsComponentCommand({
          stepBytes: new Uint8Array(bytes).buffer,
          fileName: 'cube-10mm.step',
          kernel,
          opfs,
        });
        await useAppStore.getState().bus.execute(cmd);
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
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { CreateComponentPatternCommand } = await import('/src/commands/CreateComponentPatternCommand.ts');
        const cmd = new CreateComponentPatternCommand({
          sourceInstanceId: srcId,
          dir1: 'x', count1: 4, spacing1: 15,
        });
        await useAppStore.getState().bus.execute(cmd);
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

    // ── 6. Mirror the source component across YZ plane ────────────────────────
    // loadFromBytes returns the kernel part UUID needed by MirrorComponentCommand.
    // opfs.read(srcComp.partPath) reads the .zipt archive written by ImportStepAsComponentCommand.
    await page.evaluate(
      async ([srcId]: [string]) => {
        const w = window as any;
        const { useAppStore } = await import('/src/store/useAppStore.ts');
        const { MirrorComponentCommand } = await import('/src/commands/MirrorComponentCommand.ts');
        const kernel = useAppStore.getState().kernel;
        if (!kernel) throw new Error('no kernel');
        const opfs = await w.__zilventorGetOpfs();
        const asm = useAppStore.getState().activeAssembly;
        const srcComp = (asm?.components as any[])?.find((c: any) => c.id === srcId);
        if (!srcComp) throw new Error('src component not found');
        // Load source part bytes from OPFS → get kernel part UUID
        const srcBytes = await opfs.read(srcComp.partPath);
        const srcKernelId = await kernel.loadFromBytes(srcBytes);
        const cmd = new MirrorComponentCommand({
          sourceInstanceId: srcId,
          sourcePartKernelId: srcKernelId,
          plane: 'yz',
          kernel,
          opfs,
        });
        await useAppStore.getState().bus.execute(cmd);
      },
      [srcCompId] as [string],
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
    // Source is at x=0 (origin); YZ mirror: x → -x → mirrored at x≈0
    expect(mirrorState.mirroredX).toBeCloseTo(0, 5);

    // ── 7. Screenshot the mirrored assembly ──────────────────────────────────
    await page.screenshot({ path: '/tmp/pattern-mirror-assembly.png' });

    // ── 8. Undo mirror → back to 4 ───────────────────────────────────────────
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 4,
      undefined, { timeout: 10_000 },
    );

    // ── 9. Undo pattern → back to 1 ──────────────────────────────────────────
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
    });
    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeAssembly?.components.length === 1,
      undefined, { timeout: 10_000 },
    );

    expect(pageErrors).toHaveLength(0);
  },
);
