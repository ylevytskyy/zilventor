/**
 * E2E: присадка slice 6 — drawer handles (AddDrawerHandlesCommand).
 * Real WASM · real OCCT bore paths · real OPFS · probe path (headless viewport is BLACK).
 *
 * §6 §PC-9 compliance: seeds a cabinet + drawer bank before testing handles.
 * UI-path decision: "Add Handles" button uses beginOneComponentPick which requires
 * a real 3D click — impossible headless. We therefore:
 *   1. Confirm the "Add Handles" button exists in the UI (proves UI wiring).
 *   2. Execute AddDrawerHandlesCommand via __zilventorStore.bus.execute (same as
 *      slice-4 — avoids the false-green class; the real command + OPFS + bore bake
 *      are fully exercised; only the click-pick is bypassed).
 * This matches the slice-4 precedent and is documented here per the plan's
 * "document which path" requirement.
 *
 * Assertions (§13.3-T6, §13.3-T7):
 *   A. N=3 drawer fronts get 2 handleScrew bores each → 6 total handleScrew bores in aggregate.
 *   B. hardware/bar-pull-96.zipt written to OPFS.
 *   C. Cabinet gains N=3 drawerHandle components.
 *   D. __zilventorHardwarePartCount() >= N=3 after scene rebuild (proves pull meshes RENDER).
 *   E. __zilventorBoringAggregate() shows handleScrew bores on distinct fronts.
 *   F. Undo removes drawerHandle components and clears handleScrew bores from fronts.
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'присадка slice6: AddDrawerHandlesCommand N=3 → 6 handleScrew bores + 3 pull meshes + undo',
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

    // ── A3. CreateCabinetCommand (base cabinet; openW=564 >> cc=96 + Ø5=101; slotH=~195 >> 24) ──
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
          name: 'Slice6 Cabinet',
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
    console.log('[slice6] cabinetPath =', cabinetPath);

    // ── A4. Record baseline component count ────────────────────────────────────
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
    console.log('[slice6] baseline cabinet components =', baseline);
    expect(baseline, 'cabinet must have ≥ 4 baseline components').toBeGreaterThanOrEqual(4);

    // ── B. AddDrawerBankCommand (N=3 drawers; width=564 > cc+Ø5=101 ✓) ─────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDrawerBankCommand } = await import('/src/commands/AddDrawerBankCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDrawerBankCommand({
        cabinetPath: cabPath,
        params: { count: 3, overlay: 'full', thickness: 18 },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // Wait for 6 new components (3 fronts + 3 boxes)
    await page.waitForFunction(
      ({ cabPath, base }: { cabPath: string; base: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<unknown> }> };
          };
        };
        const count = w.__zilventorStore.getState().subAssemblyDocs[cabPath]?.components.length ?? 0;
        return count >= base + 6;
      },
      { cabPath: cabinetPath, base: baseline },
      { timeout: 30_000 },
    );
    console.log('[slice6] drawer bank added — fronts and boxes present');

    // Verify fronts are present and grab front paths for later checks
    const frontPaths: string[] = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return [];
        return doc.components
          .filter((c) => c.role === 'drawerFront')
          .map((c) => c.partPath);
      },
      cabinetPath,
    );
    expect(frontPaths, 'must find 3 drawer fronts').toHaveLength(3);
    console.log('[slice6] front paths:', frontPaths);

    // ── C. UI check: "Add Handles" button exists in FurnitureTab ─────────────
    // Switch to Furniture tab and verify the button is rendered (proves UI wiring).
    // We don't click it (beginOneComponentPick requires 3D click — impossible headless).
    await page.getByRole('tab', { name: /furniture/i }).click();
    const addHandlesBtn = page.getByRole('button', { name: /add handles/i });
    await expect(addHandlesBtn).toBeVisible();
    console.log('[slice6] "Add Handles" button is visible in FurnitureTab — UI wiring confirmed');

    // ── D. AddDrawerHandlesCommand via __zilventorStore bus (PC-9 compliant) ────
    // Direct bus execution: same command path as the real button, avoids false-green.
    // The real button's only bypassed step is the viewport click-pick — the full
    // command execution, OPFS writes, and bore baking are identical.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDrawerHandlesCommand } = await import('/src/commands/AddDrawerHandlesCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDrawerHandlesCommand({
        cabinetPath: cabPath,
        cc: 96,
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // Wait for cabinet to gain N=3 drawerHandle components
    await page.waitForFunction(
      ({ cabPath, base }: { cabPath: string; base: number }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }> };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return false;
        const handleCount = doc.components.filter((c) => c.role === 'drawerHandle').length;
        return handleCount >= 3;
      },
      { cabPath: cabinetPath, base: baseline },
      { timeout: 30_000 },
    );

    const postHandleComponents = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return { handleCount: -1, hwPaths: [] as string[] };
        return {
          handleCount: doc.components.filter((c) => c.role === 'drawerHandle').length,
          hwPaths: doc.components
            .filter((c) => c.role === 'drawerHandle')
            .map((c) => c.partPath),
        };
      },
      cabinetPath,
    );
    console.log('[slice6] post-handles components:', JSON.stringify(postHandleComponents));
    expect(postHandleComponents.handleCount, 'must add N=3 drawerHandle components').toBe(3);
    // All pulls should point to the same hardware path (one SKU, reused)
    for (const hwPath of postHandleComponents.hwPaths) {
      expect(hwPath, 'pull component partPath must be hardware/bar-pull-96.zipt').toBe(
        'hardware/bar-pull-96.zipt',
      );
    }

    // ── E. OPFS: hardware part written ────────────────────────────────────────
    const hwExists: boolean = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      try {
        await opfs.read('hardware/bar-pull-96.zipt');
        return true;
      } catch {
        return false;
      }
    });
    expect(hwExists, 'hardware/bar-pull-96.zipt must be written to OPFS').toBe(true);

    // ── F. handleScrew bores in drawer front parts ───────────────────────────
    // Read each front .zipt directly from OPFS and count handleScrew bores.
    const boreInfo: { frontPath: string; handleScrewCount: number }[] = await page.evaluate(
      async (fPaths: string[]) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (
            bytes: Uint8Array,
          ) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        const results: { frontPath: string; handleScrewCount: number }[] = [];
        for (const fp of fPaths) {
          try {
            const bytes = await opfs.read(fp);
            const project = await w.__zilventorUnpackProject(bytes);
            const doc = (
              project.manifest as { document: { bores?: Array<{ connectorKind: string }> } }
            ).document;
            const count = (doc.bores ?? []).filter(
              (b) => b.connectorKind === 'handleScrew',
            ).length;
            results.push({ frontPath: fp, handleScrewCount: count });
          } catch (e) {
            results.push({ frontPath: fp, handleScrewCount: -1 });
          }
        }
        return results;
      },
      frontPaths,
    );

    console.log('[slice6] bore info per front:', JSON.stringify(boreInfo));
    for (const { frontPath, handleScrewCount } of boreInfo) {
      expect(
        handleScrewCount,
        `front ${frontPath} must have exactly 2 handleScrew bores (one pair per pull)`,
      ).toBe(2);
    }
    const totalHandleScrewBores = boreInfo.reduce((s, b) => s + b.handleScrewCount, 0);
    console.log('[slice6] total handleScrew bores:', totalHandleScrewBores);
    expect(totalHandleScrewBores, 'must have 2*N=6 total handleScrew bores across all fronts').toBe(6);

    // ── G. Force full sub-asm tree load + wait for bore markers ─────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidateAll: () => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidateAll();
    });

    const readBoreMarkerCount = async (): Promise<number> =>
      page.evaluate(() => {
        const store = (
          window as unknown as {
            __zilventorStore: { getState(): { viewport: unknown } };
          }
        ).__zilventorStore.getState();
        const vp = store.viewport as { getSceneManager?(): unknown } | null;
        const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
        return sm?.boreMarkerCount?.() ?? -1;
      });

    // Wait for ALL N=3 fronts × 2 handleScrew bores each = 6 bore markers to render.
    // Using N_FRONTS * 2 as the threshold ensures all fronts are fully reloaded
    // (invalidatePartPaths is async; partBoresCacheRef fills front-by-front).
    const N_EXPECTED_BORE_MARKERS = 6; // 3 fronts × 2 handleScrew bores each
    await expect
      .poll(readBoreMarkerCount, {
        timeout: 60_000,
        message: `bore markers must reach ${N_EXPECTED_BORE_MARKERS} (2 handleScrew bores × 3 fronts — all fronts reloaded)`,
      })
      .toBeGreaterThanOrEqual(N_EXPECTED_BORE_MARKERS);

    const markerCount = await readBoreMarkerCount();
    console.log('[slice6] bore marker count after handle application:', markerCount);
    // N=3 fronts × 2 bores each = 6 handleScrew bore markers
    expect(markerCount, 'must have ≥ 6 bore markers (2 per front × 3 fronts)').toBeGreaterThanOrEqual(6);

    // ── H. __zilventorHardwarePartCount — pulls rendered in scene ─────────────
    // Proves the pull ComponentInstances are tessellated + rendered as scene meshes.
    const readHardwarePartCount = async (): Promise<number> =>
      page.evaluate(() => {
        return (
          (window as unknown as { __zilventorHardwarePartCount?: () => number }).__zilventorHardwarePartCount?.() ?? 0
        );
      });

    await expect
      .poll(readHardwarePartCount, {
        timeout: 30_000,
        message: '__zilventorHardwarePartCount must be ≥ 3 (proves pull meshes render)',
      })
      .toBeGreaterThanOrEqual(3);

    const hwMeshCount = await readHardwarePartCount();
    console.log('[slice6] hardwarePartCount (pull meshes in scene):', hwMeshCount);
    expect(hwMeshCount, 'must have ≥ N=3 rendered hardware part meshes').toBeGreaterThanOrEqual(3);

    // ── I. __zilventorBoringAggregate — N distinct fronts bored ──────────────
    const boringResult: {
      totalBores: number;
      handleScrewCount: number;
      distinctFrontsWithHandleScrew: number;
      allRoles: string[];
    } = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorBoringAggregate: () => {
          panels: Array<{ bores: Array<{ role: string; connectorKind?: string }> }>;
        };
      };
      const result = w.__zilventorBoringAggregate();
      const allBores = result.panels.flatMap((p) => p.bores);
      const handleScrewBores = allBores.filter((b) => b.connectorKind === 'handleScrew');
      // Count panels that have at least one handleScrew bore
      const frontsWithHandle = result.panels.filter((p) =>
        p.bores.some((b) => b.connectorKind === 'handleScrew'),
      ).length;
      return {
        totalBores: allBores.length,
        handleScrewCount: handleScrewBores.length,
        distinctFrontsWithHandleScrew: frontsWithHandle,
        allRoles: [...new Set(allBores.map((b) => b.role))].sort(),
      };
    });

    console.log('[slice6] boring aggregate:', JSON.stringify(boringResult));
    expect(
      boringResult.handleScrewCount,
      `__zilventorBoringAggregate must show 2*N=6 handleScrew bores. All roles: ${boringResult.allRoles.join(', ')}`,
    ).toBe(6);
    expect(
      boringResult.distinctFrontsWithHandleScrew,
      'aggregation must reach ALL 3 fronts (recursion to every drawer front)',
    ).toBe(3);

    // ── J. Undo removes drawerHandle components ────────────────────────────────
    // Undo via the SAME bus the command was executed on (window-exposed store).
    // A dynamic `import('/src/store/useAppStore.ts')` resolves to a DIFFERENT module
    // instance with its own empty bus → undo would be a silent no-op.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
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

    // Wait for drawerHandle components to disappear
    await page.waitForFunction(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return false;
        const handleCount = doc.components.filter((c) => c.role === 'drawerHandle').length;
        return handleCount === 0;
      },
      cabinetPath,
      { timeout: 30_000 },
    );

    const afterUndo = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        if (!doc) return { handleCount: -1 };
        return {
          handleCount: doc.components.filter((c) => c.role === 'drawerHandle').length,
        };
      },
      cabinetPath,
    );

    console.log('[slice6] after undo:', JSON.stringify(afterUndo));
    expect(afterUndo.handleCount, 'undo must remove all drawerHandle components').toBe(0);

    // After undo: verify bores are also removed from fronts
    const boreInfoAfterUndo: { frontPath: string; handleScrewCount: number }[] =
      await page.evaluate(
        async (fPaths: string[]) => {
          const w = window as unknown as {
            __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
            __zilventorUnpackProject: (
              bytes: Uint8Array,
            ) => Promise<{ manifest: unknown }>;
          };
          const opfs = await w.__zilventorGetOpfs();
          const results: { frontPath: string; handleScrewCount: number }[] = [];
          for (const fp of fPaths) {
            try {
              const bytes = await opfs.read(fp);
              const project = await w.__zilventorUnpackProject(bytes);
              const doc = (
                project.manifest as { document: { bores?: Array<{ connectorKind: string }> } }
              ).document;
              const count = (doc.bores ?? []).filter(
                (b) => b.connectorKind === 'handleScrew',
              ).length;
              results.push({ frontPath: fp, handleScrewCount: count });
            } catch {
              results.push({ frontPath: fp, handleScrewCount: -1 });
            }
          }
          return results;
        },
        frontPaths,
      );

    console.log('[slice6] bore info after undo:', JSON.stringify(boreInfoAfterUndo));
    for (const { frontPath, handleScrewCount } of boreInfoAfterUndo) {
      expect(
        handleScrewCount,
        `after undo, front ${frontPath} must have 0 handleScrew bores`,
      ).toBe(0);
    }

    // ── K. No browser errors ───────────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during slice-6 e2e flow').toHaveLength(0);
  },
);
