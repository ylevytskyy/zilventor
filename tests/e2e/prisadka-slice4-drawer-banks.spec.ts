/**
 * E2E: присадка slice 4 — drawer-bank command (Chunk K).
 * Real WASM · real OCCT bore paths · real OPFS · probe path (headless viewport is BLACK).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet, generous dims).
 *   B. AddDrawerBankCommand (N=3, full overlay, thickness=18) via __zilventorStore bus.
 *   C. Assert cabinet component count grew by 6 (3 drawerFront + 3 drawerBox).
 *   D. Assert bore markers render (proves box panels are real geometry, not placeholders).
 *   E. OPFS-unpack one box .ziasm → 5 panel components + box-side bores present.
 *   F. __zilventorBoringAggregate() returns ≥1 bore with role:'drawerSlide-box'
 *      (proves aggregateBoresRecursive recursion reaches nested box panels — C-10).
 *   G. Undo → component count back to baseline (no fronts, no boxes).
 *
 * C-10 NOTE: __zilventorBoringAggregate already exists in App.tsx (line ~531).
 * After the command runs, we call __zilventorSubAsmInvalidateAll to force BFS reload of
 * all nested .ziasm (cabinet → box) into subAssemblyDocs, then wait for boreMarkerCount > 0
 * to confirm partBoresCacheRef is populated with box-side bores, then call the probe.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'присадка slice4: AddDrawerBankCommand N=3 → 6 components + box panels + drawerSlide-box bores + undo',
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

    // ── A3. CreateCabinetCommand (base cabinet, large enough for 3 drawers) ────
    // openW = 600 - 2*18 = 564 >> 57; slotH = (720-100-36)/3 = 194.7 >> 24
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
          name: 'Slice4 Cabinet',
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
    console.log('[slice4] cabinetPath =', cabinetPath);

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
    console.log('[slice4] baseline cabinet components =', baseline);
    // A standard baseCabinet has: leftSide, rightSide, top, bottom, back = 5 panels
    expect(baseline, 'cabinet must have ≥ 4 baseline components before drawer bank').toBeGreaterThanOrEqual(4);

    // ── B. AddDrawerBankCommand (N=3, full overlay, thickness=18) ──────────────
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

    // ── C. Assert cabinet component count grew by 6 (3 fronts + 3 boxes) ────────
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

    const postAddComponents: { total: number; frontRoles: number; boxRoles: number } =
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
          if (!doc) return { total: -1, frontRoles: -1, boxRoles: -1 };
          return {
            total: doc.components.length,
            frontRoles: doc.components.filter((c) => c.role === 'drawerFront').length,
            boxRoles: doc.components.filter((c) => c.role === 'drawerBox').length,
          };
        },
        cabinetPath,
      );

    console.log('[slice4] post-add components:', JSON.stringify(postAddComponents));
    expect(
      postAddComponents.total - baseline,
      'cabinet must gain exactly 6 components (3 fronts + 3 boxes)',
    ).toBe(6);
    expect(postAddComponents.frontRoles, 'must have 3 drawerFront components').toBe(3);
    expect(postAddComponents.boxRoles, 'must have 3 drawerBox components').toBe(3);

    // ── D. Force full sub-asm tree load + wait for bore markers ─────────────────
    // __zilventorSubAsmInvalidateAll does BFS walk from activeAssembly through all
    // nested .ziasm (top → cabinet → boxes), loading them into subAssemblyDocs.
    // Once boxes are in subAssemblyDocs the bore-marker effect can populate partBoresCacheRef
    // with box-side bores, making boreMarkerCount() > 0.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorSubAsmInvalidateAll: () => Promise<void>;
      };
      await w.__zilventorSubAsmInvalidateAll();
    });

    const readBoreMarkerCount = async (): Promise<number> =>
      page.evaluate(() => {
        const store = (window as unknown as {
          __zilventorStore: { getState(): { viewport: unknown } };
        }).__zilventorStore.getState();
        const vp = store.viewport as { getSceneManager?(): unknown } | null;
        const sm = vp?.getSceneManager?.() as { boreMarkerCount(): number } | null;
        return sm?.boreMarkerCount?.() ?? -1;
      });

    await expect
      .poll(readBoreMarkerCount, {
        timeout: 30_000,
        message: 'bore markers must render > 0 (proves box panels loaded + bore cache populated)',
      })
      .toBeGreaterThan(0);
    const markerCount = await readBoreMarkerCount();
    console.log('[slice4] bore markers after drawer bank:', markerCount);

    // ── E. OPFS-unpack one box .ziasm → 5 panel components + box-side bores ────
    // Pick the first drawerBox component's partPath from the cabinet doc.
    const boxAsmPath: string = await page.evaluate(
      (cabPath: string) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
            };
          };
        };
        const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
        return doc?.components.find((c) => c.role === 'drawerBox')?.partPath ?? '';
      },
      cabinetPath,
    );
    expect(boxAsmPath, 'must find a drawerBox component with a .ziasm path').toMatch(/\.ziasm$/);
    console.log('[slice4] boxAsmPath =', boxAsmPath);

    // Read the box .ziasm from OPFS and check 5 panel components
    const boxInfo: {
      panelCount: number;
      roles: string[];
      boxSideBoreCount: number;
    } = await page.evaluate(async (boxPath: string) => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();

      // The box .ziasm is an assembly; we read it via the sub-assembly docs (already loaded)
      // or directly via the sub-assembly cache in the store.
      // Use __zilventorStore.subAssemblyDocs for the box if available (it was loaded by
      // __zilventorSubAsmInvalidateAll above).
      const boxStore = (window as unknown as {
        __zilventorStore: {
          getState(): {
            subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
          };
        };
      }).__zilventorStore.getState().subAssemblyDocs;

      const boxDoc = boxStore[boxPath];
      if (!boxDoc) return { panelCount: -1, roles: [], boxSideBoreCount: -1 };

      const panelCount = boxDoc.components.length;
      const roles = boxDoc.components.map((c) => c.role ?? 'undefined');

      // Check each component for box-side bores by reading the panel .zipt
      let boxSideBoreCount = 0;
      for (const comp of boxDoc.components) {
        if (!comp.partPath.endsWith('.zipt')) continue;
        try {
          const bytes = await opfs.read(comp.partPath);
          const project = await w.__zilventorUnpackProject(bytes);
          const doc = (project.manifest as { document: { bores?: Array<{ role: string }> } }).document;
          const drawerSlideBores = (doc.bores ?? []).filter((b) => b.role === 'drawerSlide-box');
          boxSideBoreCount += drawerSlideBores.length;
        } catch { /* skip */ }
      }

      return { panelCount, roles, boxSideBoreCount };
    }, boxAsmPath);

    console.log('[slice4] box info:', JSON.stringify(boxInfo));
    expect(boxInfo.panelCount, 'box .ziasm must have exactly 5 panel components').toBe(5);
    // Roles: 2x drawerBox-side, 1x drawerBox-front, 1x drawerBox-back, 1x drawerBox-bottom
    const sortedRoles = [...boxInfo.roles].sort();
    expect(sortedRoles).toEqual(
      ['drawerBox-back', 'drawerBox-bottom', 'drawerBox-front', 'drawerBox-side', 'drawerBox-side'],
    );
    expect(
      boxInfo.boxSideBoreCount,
      'box side panels must carry ≥1 drawerSlide-box bore (Ø5 slide rows written by AddDrawerBankCommand)',
    ).toBeGreaterThan(0);

    // ── F. __zilventorBoringAggregate returns ≥1 bore with role:'drawerSlide-box' ──
    // This proves aggregateBoresRecursive RECURSION reaches nested box panel bores
    // (C-10 requirement: ensures the boring map/aggregate reaches the nested .ziasm level).
    // Wait until partBoresCacheRef is populated for box panels (bore markers already ≥1).
    const boringResult: {
      totalBores: number;
      drawerSlideCabinetCount: number;
      drawerSlideBoxCount: number;
      allRoles: string[];
    } = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorBoringAggregate: () => {
          panels: Array<{ bores: Array<{ role: string }> }>;
        };
      };
      const result = w.__zilventorBoringAggregate();
      const allBores = result.panels.flatMap((p) => p.bores);
      return {
        totalBores: allBores.length,
        drawerSlideCabinetCount: allBores.filter((b) => b.role === 'drawerSlide-cabinet').length,
        drawerSlideBoxCount: allBores.filter((b) => b.role === 'drawerSlide-box').length,
        allRoles: [...new Set(allBores.map((b) => b.role))].sort(),
      };
    });

    console.log('[slice4] boring aggregate:', JSON.stringify(boringResult));
    expect(
      boringResult.drawerSlideBoxCount,
      `__zilventorBoringAggregate must return ≥1 bore with role:'drawerSlide-box' — proves recursion reaches nested box panels (C-10). All roles found: ${boringResult.allRoles.join(', ')}`,
    ).toBeGreaterThan(0);
    expect(
      boringResult.drawerSlideCabinetCount,
      'boring aggregate must contain ≥1 drawerSlide-cabinet bore (cabinet side panels)',
    ).toBeGreaterThan(0);

    // ── G. Undo → component count returns to baseline ──────────────────────────
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      await useAppStore.getState().bus.undo();
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

    const afterUndo: { componentCount: number; drawerFronts: number; drawerBoxes: number } =
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
          if (!doc) return { componentCount: -1, drawerFronts: -1, drawerBoxes: -1 };
          return {
            componentCount: doc.components.length,
            drawerFronts: doc.components.filter((c) => c.role === 'drawerFront').length,
            drawerBoxes: doc.components.filter((c) => c.role === 'drawerBox').length,
          };
        },
        cabinetPath,
      );

    console.log('[slice4] after undo:', JSON.stringify(afterUndo));
    expect(
      afterUndo.componentCount,
      `undo must restore cabinet to baseline (${baseline}) components`,
    ).toBe(baseline);
    expect(afterUndo.drawerFronts, 'undo must remove all drawerFront components').toBe(0);
    expect(afterUndo.drawerBoxes, 'undo must remove all drawerBox components').toBe(0);

    // ── Final: no browser errors ─────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during slice-4 e2e flow').toHaveLength(0);
  },
);
