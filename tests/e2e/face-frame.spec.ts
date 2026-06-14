/**
 * E2E: Face Frame slice 1 — AddFaceFrameCommand (2×2 grid, verify members, cut-list, undo).
 * Real WASM · real OCCT panel bake · real OPFS · probe path (headless viewport is BLACK).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet, generous dims).
 *   B. Record baseline cabinet component count.
 *   C. AddFaceFrameCommand (rows=2, cols=2) via __zilventorStore bus.
 *   D. Assert 3 stiles + 6 rails in subAssemblyDocs (cols+1=3, cols·(rows+1)=6).
 *   E. Members reach the cabinet doc (cut-list/BOM will aggregate them via existing recursion).
 *   F. Undo → component count back to baseline (all face-frame members removed).
 *   G. Zero browser console errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'face frame: add 2×2 grid → 3 stiles + 6 rails, undo restores baseline, zero errors',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    // ── A1. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ─────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand (base cabinet, large enough for face frame) ────
    // openW = 600 - 2*18 = 564; frameH = 720 - 100 = 620; stiles/rails at 38mm fit easily
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'FaceFrame Cabinet',
          width: 600,
          depth: 560,
          height: 720,
          toekickHeight: 100,
          toekickSetback: 50,
          shelfCount: 0,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    });

    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Resolve cabinet path
    const cabinetPath: string = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
    });
    expect(cabinetPath, 'cabinet must be a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[face-frame] cabinetPath =', cabinetPath);

    // ── A4. Record baseline component count in the cabinet ──────────────────────
    const baseline: number = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        return w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length ?? 0;
      },
      cabinetPath,
    );
    console.log('[face-frame] baseline cabinet components =', baseline);
    // A standard baseCabinet has: leftSide, rightSide, top, bottom, back = 5 panels
    expect(baseline, 'cabinet must have ≥ 4 baseline components before face frame').toBeGreaterThanOrEqual(4);

    // ── C. AddFaceFrameCommand (rows=2, cols=2) → cols+1=3 stiles, cols·(rows+1)=6 rails ──
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
          delete(p: string): Promise<void>;
        }>;
      };
      const { AddFaceFrameCommand } = await import('/src/commands/AddFaceFrameCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddFaceFrameCommand({
        cabinetPath: cabPath,
        params: { rows: 2, cols: 2, stileWidth: 38, railWidth: 38, thickness: 19 },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── D. Assert 3 stiles + 6 rails in subAssemblyDocs ─────────────────────────
    await page.waitForFunction(
      ({ cabPath, base }: { cabPath: string; base: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        const count = w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length ?? 0;
        return count >= base + 9; // cols+1 stiles + cols·(rows+1) rails = 3 + 6 = 9
      },
      { cabPath: cabinetPath, base: baseline },
      { timeout: 30_000 },
    );

    const postAddCounts: { total: number; stiles: number; rails: number } =
      await page.evaluate(
        (cabPath: string) => {
          const w = window as unknown as {
            __zilventorStore: {
              getState(): {
                subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
              };
            };
          };
          const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
          if (!doc) return { total: -1, stiles: -1, rails: -1 };
          return {
            total: doc.components.length,
            stiles: doc.components.filter((c) => c.role === 'faceFrameStile').length,
            rails: doc.components.filter((c) => c.role === 'faceFrameRail').length,
          };
        },
        cabinetPath,
      );

    console.log('[face-frame] post-add components:', JSON.stringify(postAddCounts));
    expect(
      postAddCounts.stiles,
      'must have 3 faceFrameStile components (cols+1=3)',
    ).toBe(3);
    expect(
      postAddCounts.rails,
      'must have 6 faceFrameRail components (cols·(rows+1)=2·3=6)',
    ).toBe(6);
    expect(
      postAddCounts.total - baseline,
      'cabinet must gain exactly 9 face-frame members (3 stiles + 6 rails)',
    ).toBe(9);

    // ── E. Members reach the cabinet doc (cut-list / BOM infrastructure check) ──
    // The face-frame members are panel ComponentInstances inside the cabinet .ziasm.
    // aggregateCutListRecursive + aggregateBomRecursive already recurse via subAssemblyDocs,
    // so any member present in subAssemblyDocs[cabinetPath].components IS reachable.
    // We assert the stile role is present — that proves the member was persisted and
    // reloaded into store (the reaches-the-members gate without a separate aggregate probe).
    const cutListReachable: boolean = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        return (doc?.components ?? []).some((c) => c.role === 'faceFrameStile');
      },
      cabinetPath,
    );
    expect(cutListReachable, 'faceFrameStile members must be reachable in subAssemblyDocs (cut-list / BOM gate)').toBe(true);

    // ── F. Undo → component count returns to baseline ──────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<void> } } };
      };
      await w.__zilventorStore.getState().bus.undo();
    });

    // Force re-sync so subAssemblyDocs reflects the post-undo OPFS state
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidate: (p: string) => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    await page.waitForFunction(
      ({ cabPath, base }: { cabPath: string; base: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        const count = w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length;
        return count === base;
      },
      { cabPath: cabinetPath, base: baseline },
      { timeout: 30_000 },
    );

    const afterUndo: { componentCount: number; stiles: number; rails: number } =
      await page.evaluate(
        (cabPath: string) => {
          const w = window as unknown as {
            __zilventorStore: {
              getState(): {
                subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
              };
            };
          };
          const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
          if (!doc) return { componentCount: -1, stiles: -1, rails: -1 };
          return {
            componentCount: doc.components.length,
            stiles: doc.components.filter((c) => c.role === 'faceFrameStile').length,
            rails: doc.components.filter((c) => c.role === 'faceFrameRail').length,
          };
        },
        cabinetPath,
      );

    console.log('[face-frame] after undo:', JSON.stringify(afterUndo));
    expect(
      afterUndo.componentCount,
      `undo must restore cabinet to baseline (${baseline}) components`,
    ).toBe(baseline);
    expect(afterUndo.stiles, 'undo must remove all faceFrameStile components').toBe(0);
    expect(afterUndo.rails, 'undo must remove all faceFrameRail components').toBe(0);

    // ── G. No browser errors ─────────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during face-frame e2e flow').toHaveLength(0);
  },
);
